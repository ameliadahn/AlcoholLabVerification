"use client";

/**
 * BatchResultsPanel
 *
 * Shows a live-updating table of all submissions in a batch run.
 * Rows update in real-time as slots complete. Clicking "View" on any
 * completed row opens a full ValidationPanel in a slide-over drawer.
 * An "Export CSV" button downloads all completed results.
 */

import { useState } from "react";
import { BatchLabelSubmission, ValidationStatus } from "@/lib/types";
import { BatchStats } from "@/lib/useBatchQueue";
import StatusBadge from "./StatusBadge";
import ValidationPanel from "./ValidationPanel";

interface BatchResultsPanelProps {
  submissions: BatchLabelSubmission[];
  stats: BatchStats;
  isRunning: boolean;
  /** Elapsed milliseconds since the batch started, tracked in the parent. */
  elapsedMs: number;
  onAbort: () => void;
  onOverride: (submissionId: string, status: ValidationStatus, notes: string) => void;
}

function exportCSV(submissions: BatchLabelSubmission[]) {
  const headers = [
    "#",
    "Submission ID",
    "Brand",
    "Status",
    "Confidence (%)",
    "Brand Name",
    "Class/Type",
    "Alcohol Content",
    "Net Contents",
    "Bottler",
    "Gov Warning",
    "Country",
    "Processing Time (s)",
    "Used AI",
  ];

  const rows = submissions
    .filter((s) => s.result)
    .map((s, i) => {
      const r = s.result!;
      const eff = r.reviewerOverride?.status ?? r.overallStatus;
      return [
        String(i + 1),
        s.submissionLabel,
        r.matchedApplicationData?.brandName ?? "",
        eff,
        r.ocrConfidence.toFixed(0),
        r.fields.brandName.status,
        r.fields.classType.status,
        r.fields.alcoholContent.status,
        r.fields.netContents.status,
        r.fields.bottlerImporter.status,
        r.fields.governmentWarning.status,
        r.fields.countryOfOrigin.status,
        (r.processingTimeMs / 1000).toFixed(1),
        r.usedAi ? "Yes" : "No",
      ];
    });

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ttb-batch-results-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ProgressBar({ stats }: { stats: BatchStats }) {
  const done = stats.complete + stats.error;
  const pct = stats.total > 0 ? (done / stats.total) * 100 : 0;
  return (
    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        className="h-full bg-blue-500 transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function RowStatus({ submission }: { submission: BatchLabelSubmission }) {
  if (submission.status === "processing") {
    return (
      <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-600">
        <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        Analyzing…
      </div>
    );
  }
  if (submission.status === "pending") {
    return <span className="text-xs text-gray-400 font-medium">Queued</span>;
  }
  if (submission.status === "error") {
    return <span className="text-xs font-semibold text-red-600">Error</span>;
  }
  if (submission.status === "complete" && submission.result) {
    const eff = submission.result.reviewerOverride?.status ?? submission.result.overallStatus;
    return <StatusBadge status={eff} />;
  }
  return null;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export default function BatchResultsPanel({
  submissions,
  stats,
  isRunning,
  elapsedMs,
  onAbort,
  onOverride,
}: BatchResultsPanelProps) {
  const [drawerSubmissionId, setDrawerSubmissionId] = useState<string | null>(null);
  const [drawerActivePanelIdx, setDrawerActivePanelIdx] = useState(0);

  const drawerSubmission = submissions.find((s) => s.id === drawerSubmissionId) ?? null;
  const completedCount = stats.complete + stats.error;
  const showTimer = isRunning || elapsedMs > 0;

  return (
    <div className="flex flex-col gap-4 min-h-0">
      {/* Summary header */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              Batch Processing
              {isRunning && (
                <span className="text-sm font-normal text-blue-600">
                  {completedCount} / {stats.total} done
                </span>
              )}
              {showTimer && (
                <span className={`inline-flex items-center gap-1 text-sm font-mono tabular-nums px-2 py-0.5 rounded-md border ${
                  isRunning
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-gray-50 text-gray-500 border-gray-200"
                }`}>
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {formatElapsed(elapsedMs)}
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {stats.total} submission{stats.total !== 1 ? "s" : ""} ·{" "}
              {stats.processing > 0 && `${stats.processing} running · `}
              {stats.pending > 0 && `${stats.pending} queued · `}
              <span className="text-emerald-600 font-semibold">{stats.pass} pass</span>
              {stats.fail > 0 && (
                <> · <span className="text-red-600 font-semibold">{stats.fail} fail</span></>
              )}
              {stats.review > 0 && (
                <> · <span className="text-amber-600 font-semibold">{stats.review} review</span></>
              )}
              {stats.error > 0 && (
                <> · <span className="text-red-400 font-semibold">{stats.error} error</span></>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isRunning ? (
              <button
                onClick={onAbort}
                className="px-3 py-1.5 text-sm font-semibold rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
              >
                Stop
              </button>
            ) : stats.complete > 0 ? (
              <button
                onClick={() => exportCSV(submissions)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export CSV
              </button>
            ) : null}
          </div>
        </div>

        {(isRunning || completedCount > 0) && <ProgressBar stats={stats} />}
      </div>

      {/* Submissions table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex-1 min-h-0">
        <div className="overflow-y-auto max-h-[calc(100vh-22rem)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 w-8">#</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Submission</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Status</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 hidden md:table-cell">Brand</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 hidden lg:table-cell">Fields</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 hidden lg:table-cell">Time</th>
                <th className="px-4 py-2.5 w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {submissions.map((submission, i) => {
                const r = submission.result;
                const brand = r?.matchedApplicationData?.brandName ?? (submission.applicationData?.brandName ?? "—");
                const allFields = r
                  ? Object.values(r.fields)
                  : null;
                const pass = allFields?.filter((f) => f.status === "pass").length ?? 0;
                const fail = allFields?.filter((f) => f.status === "fail").length ?? 0;
                const review = allFields?.filter((f) => f.status === "review").length ?? 0;
                const total = allFields?.length ?? 0;

                return (
                  <tr
                    key={submission.id}
                    className={`transition-colors ${
                      drawerSubmissionId === submission.id
                        ? "bg-blue-50"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {submission.panels[0] &&
                          submission.panels[0].file.type !== "application/pdf" ? (
                          <div className="w-8 h-10 rounded border border-gray-200 overflow-hidden shrink-0 bg-gray-100">
                            <img
                              src={submission.panels[0].previewUrl}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ) : (
                          <div className="w-8 h-10 rounded border border-gray-200 bg-gray-100 shrink-0 flex items-center justify-center text-[9px] font-bold text-gray-400">
                            PDF
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-800 truncate max-w-[12rem]" title={submission.submissionLabel}>
                            {submission.submissionLabel}
                          </p>
                          <p className="text-xs text-gray-400">
                            {submission.panels.length} panel{submission.panels.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RowStatus submission={submission} />
                      {submission.status === "error" && submission.error && (
                        <p className="text-xs text-red-500 mt-0.5 max-w-[12rem] truncate" title={submission.error}>
                          {submission.error}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-gray-700 truncate block max-w-[10rem]" title={brand}>
                        {brand}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {allFields ? (
                        <div className="flex items-center gap-1">
                          <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-semibold">
                            {pass}✓
                          </span>
                          {fail > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold">
                              {fail}✗
                            </span>
                          )}
                          {review > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold">
                              {review}⚠
                            </span>
                          )}
                          <span className="text-[10px] text-gray-400">/{total}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {r ? (
                        <span className="text-xs text-gray-500">
                          {(r.processingTimeMs / 1000).toFixed(1)}s
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {submission.status === "complete" && submission.result && (
                        <button
                          onClick={() => {
                            setDrawerSubmissionId(submission.id);
                            setDrawerActivePanelIdx(0);
                          }}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          View
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail drawer */}
      {drawerSubmission?.result && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="flex-1 bg-black/40"
            onClick={() => setDrawerSubmissionId(null)}
          />
          {/* Panel */}
          <div className="w-full max-w-2xl bg-white shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 shrink-0">
              <div>
                <p className="font-bold text-gray-900 text-sm">{drawerSubmission.submissionLabel}</p>
                <p className="text-xs text-gray-500">
                  {drawerSubmission.panels.length} panel{drawerSubmission.panels.length !== 1 ? "s" : ""}
                </p>
              </div>
              <button
                onClick={() => setDrawerSubmissionId(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 text-gray-500 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <ValidationPanel
                result={drawerSubmission.result}
                activePanelIdx={drawerActivePanelIdx}
                onSelectPanel={setDrawerActivePanelIdx}
                onOverride={(status, notes) => {
                  onOverride(drawerSubmission.id, status, notes);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
