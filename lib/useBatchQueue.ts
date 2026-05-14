"use client";

/**
 * Concurrency-capped batch processing queue.
 *
 * Runs up to `concurrencyLimit` label submissions in parallel.
 * Results stream back as each slot completes — the UI updates live.
 * Aborting mid-run resets in-flight items to "pending" so they can be retried.
 */

import { useState, useCallback, useRef } from "react";
import { BatchLabelSubmission } from "./types";
import { processSubmission } from "./processor";

export interface BatchStats {
  total: number;
  pending: number;
  processing: number;
  complete: number;
  error: number;
  pass: number;
  fail: number;
  review: number;
}

// Claude Haiku (with prompt caching) consumes ~3,500 fresh input tokens per label
// (images + user text) once the 6,700-token system prompt is cached.
// Anthropic Tier 1 limit is 100,000 TPM.
// At concurrency=7: 7 × ~12k uncached tokens = ~84k TPM — safely under the cap.
// At concurrency=10: 10 × ~12k = ~120k TPM — exceeds Tier 1, causing hard 429s
// that trigger the RATE_LIMIT_WAIT_MS delay and inflate total batch time.
const DEFAULT_CONCURRENCY = 7;

// Stagger between slot releases (ms).  Prevents a burst of simultaneous requests.
const SLOT_STAGGER_MS = 500;

// When Anthropic returns a hard 429 rate-limit error, wait this long before
// retrying.  20 s is enough for the per-minute token bucket to partially refill.
const RATE_LIMIT_WAIT_MS = 20_000;

// Maximum number of automatic rate-limit retries per submission.
const MAX_RATE_LIMIT_RETRIES = 3;

export function useBatchQueue(concurrencyLimit = DEFAULT_CONCURRENCY) {
  const [submissions, setSubmissions] = useState<BatchLabelSubmission[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const isRunningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const startBatch = useCallback(
    async (items: BatchLabelSubmission[]) => {
      if (isRunningRef.current) return;
      isRunningRef.current = true;
      setIsRunning(true);

      const pending: BatchLabelSubmission[] = items.map((s) => ({
        ...s,
        status: "pending" as const,
        result: undefined,
        error: undefined,
      }));
      setSubmissions(pending);

      const controller = new AbortController();
      abortRef.current = controller;

      // Simple semaphore: tracks available slots + a queue of waiters
      let available = concurrencyLimit;
      const waiters: Array<() => void> = [];

      const acquire = () =>
        new Promise<void>((resolve) => {
          if (available > 0) {
            available--;
            resolve();
          } else {
            waiters.push(resolve);
          }
        });

      const release = () => {
        const next = waiters.shift();
        if (next) {
          // Stagger the handoff so the next request doesn't fire at the exact
          // same instant as any other in-flight request, reducing token bursts.
          setTimeout(next, SLOT_STAGGER_MS);
        } else {
          available++;
        }
      };

      await Promise.allSettled(
        pending.map(async (submission) => {
          await acquire();

          if (controller.signal.aborted) {
            release();
            return;
          }

          setSubmissions((prev) =>
            prev.map((s) =>
              s.id === submission.id ? { ...s, status: "processing" } : s
            )
          );

          let rateLimitRetries = 0;
          // Outer try/finally guarantees the semaphore slot is always released,
          // even if the retry loop exits via break or an unexpected throw.
          try {
            // Retry loop: automatically waits and retries on OpenAI 429 rate-limit
            // errors so transient token-budget exhaustion doesn't surface as a
            // hard failure for the user.
            for (;;) {
              try {
                const result = await processSubmission(
                  submission.panels,
                  undefined,
                  submission.applicationData,
                  controller.signal
                );
                setSubmissions((prev) =>
                  prev.map((s) =>
                    s.id === submission.id ? { ...s, status: "complete", result } : s
                  )
                );
                break;
              } catch (err) {
                // Abort errors mean the user cancelled the batch — restore to pending.
                if (err instanceof Error && err.name === "AbortError") {
                  setSubmissions((prev) =>
                    prev.map((s) =>
                      s.id === submission.id ? { ...s, status: "pending" } : s
                    )
                  );
                  break;
                }

                // Rate-limit errors: wait for the OpenAI token window to refill,
                // then retry automatically (up to MAX_RATE_LIMIT_RETRIES times).
                const isRateLimit = (err as { isRateLimit?: boolean })?.isRateLimit === true
                  || (err instanceof Error && /rate.?limit|429/i.test(err.message));

                if (isRateLimit && rateLimitRetries < MAX_RATE_LIMIT_RETRIES && !controller.signal.aborted) {
                  rateLimitRetries++;
                  // Keep status as "processing" so the UI shows progress, not an error.
                  await new Promise<void>((resolve) => {
                    const t = setTimeout(resolve, RATE_LIMIT_WAIT_MS);
                    // Respect abort during the wait.
                    controller.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
                  });
                  continue;
                }

                // Non-rate-limit error, or retries exhausted — surface as a hard error.
                setSubmissions((prev) =>
                  prev.map((s) =>
                    s.id === submission.id
                      ? { ...s, status: "error", error: String(err) }
                      : s
                  )
                );
                break;
              }
            }
          } finally {
            release();
          }
        })
      );

      isRunningRef.current = false;
      setIsRunning(false);
      abortRef.current = null;
    },
    [concurrencyLimit]
  );

  const abortBatch = useCallback(() => {
    abortRef.current?.abort();
    isRunningRef.current = false;
    setIsRunning(false);
  }, []);

  const resetBatch = useCallback(() => {
    abortRef.current?.abort();
    isRunningRef.current = false;
    setSubmissions([]);
    setIsRunning(false);
  }, []);

  /** Apply a reviewer override to a completed submission's result */
  const applyOverride = useCallback(
    (submissionId: string, status: "pass" | "fail" | "review", notes: string) => {
      setSubmissions((prev) =>
        prev.map((s) => {
          if (s.id !== submissionId || !s.result) return s;
          return {
            ...s,
            result: {
              ...s.result,
              reviewerOverride: {
                status,
                notes,
                reviewedAt: new Date().toISOString(),
              },
            },
          };
        })
      );
    },
    []
  );

  const stats: BatchStats = {
    total: submissions.length,
    pending: submissions.filter((s) => s.status === "pending").length,
    processing: submissions.filter((s) => s.status === "processing").length,
    complete: submissions.filter((s) => s.status === "complete").length,
    error: submissions.filter((s) => s.status === "error").length,
    pass: submissions.filter((s) => s.result?.overallStatus === "pass").length,
    fail: submissions.filter((s) => s.result?.overallStatus === "fail").length,
    review: submissions.filter((s) => s.result?.overallStatus === "review").length,
  };

  return {
    submissions,
    isRunning,
    stats,
    startBatch,
    abortBatch,
    resetBatch,
    applyOverride,
  };
}
