"use client";

import { useState } from "react";
import { FieldValidationResult } from "@/lib/types";
import StatusBadge from "./StatusBadge";

interface ParsedClaim {
  category: string;
  severity: "FAIL" | "REVIEW";
  claim: string;
  reason: string;
}

function parseProhibitedClaims(raw: string): ParsedClaim[] {
  // Claims are pipe-separated; each claim is [CATEGORY|SEVERITY]: "text" — reason
  // Split only on | that is immediately followed by [ to avoid splitting inside [X|Y]
  const parts = raw.split(/\s*\|\s*(?=\[)/);
  const re = /\[([^\]|]+)\|(FAIL|REVIEW)\]:\s*"([^"]+)"\s*[—\-]+\s*(.+)/i;
  return parts.flatMap((part) => {
    const m = part.trim().match(re);
    if (!m) return [];
    return [{ category: m[1].trim(), severity: m[2].toUpperCase() as "FAIL" | "REVIEW", claim: m[3].trim(), reason: m[4].trim() }];
  });
}

interface FieldResultProps {
  result: FieldValidationResult;
}

const fieldColors = {
  pass: "border-emerald-200 bg-emerald-50",
  fail: "border-red-200 bg-red-50",
  review: "border-amber-200 bg-amber-50",
};

function ConfidencePill({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence);
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded border bg-transparent text-gray-500 border-gray-300"
      title="Field confidence score"
    >
      <span className="tabular-nums">{pct}%</span>
      <span className="opacity-60 text-[10px]">conf</span>
    </span>
  );
}

export default function FieldResult({ result }: FieldResultProps) {
  const [expanded, setExpanded] = useState(false);

  // Parse detected claims for the Prohibited Claims field so they can be shown inline.
  const isClaimsField = result.field === "Prohibited Claims";
  const parsedClaims: ParsedClaim[] =
    isClaimsField && result.extractedValue && result.status !== "pass"
      ? parseProhibitedClaims(result.extractedValue)
      : [];
  const hasParsedClaims = parsedClaims.length > 0;

  return (
    <div className={`rounded-lg border p-4 ${fieldColors[result.status]}`}>
      <div
        className="flex items-start justify-between cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <StatusBadge status={result.status} />
          <span className="font-semibold text-gray-800 text-sm">{result.field}</span>
          <ConfidencePill confidence={result.confidence} />
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      <p className="mt-2 text-sm text-gray-700">{result.message}</p>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-gray-200 pt-3">
          {/* Prohibited claims — shown on expand */}
          {hasParsedClaims && (
            <div className="space-y-2">
              {parsedClaims.map((c, i) => (
                <div key={i} className="flex flex-col gap-0.5 text-xs rounded border bg-white px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${
                      c.severity === "FAIL"
                        ? "bg-red-100 text-red-700 border border-red-200"
                        : "bg-amber-100 text-amber-700 border border-amber-200"
                    }`}>
                      {c.severity}
                    </span>
                    <span className="font-semibold text-gray-700">{c.category}</span>
                    <span className="italic text-gray-800">&ldquo;{c.claim}&rdquo;</span>
                  </div>
                  <p className="text-gray-500 leading-snug">{c.reason}</p>
                </div>
              ))}
            </div>
          )}

          {/* Unparseable claims fallback */}
          {isClaimsField && !hasParsedClaims && result.extractedValue && result.status !== "pass" && (
            <div className="text-xs">
              <span className="font-semibold text-gray-600">Extracted from label:</span>
              <span className="ml-2 font-mono bg-white px-1.5 py-0.5 rounded border text-gray-800 break-all">
                {result.extractedValue}
              </span>
            </div>
          )}

          {result.extractedValue && !isClaimsField && (
            <div className="text-xs">
              <span className="font-semibold text-gray-600">Extracted from label:</span>
              <span className="ml-2 font-mono bg-white px-1.5 py-0.5 rounded border text-gray-800">
                {result.extractedValue}
              </span>
            </div>
          )}
          {result.expectedValue && (
            <div className="text-xs">
              <span className="font-semibold text-gray-600">Application data:</span>
              <span className="ml-2 font-mono bg-white px-1.5 py-0.5 rounded border text-gray-800">
                {result.expectedValue}
              </span>
            </div>
          )}
          {result.detail && !isClaimsField && (
            <div className="text-xs text-gray-600 italic">{result.detail}</div>
          )}
        </div>
      )}
    </div>
  );
}
