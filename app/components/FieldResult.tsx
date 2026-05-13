"use client";

import { useState } from "react";
import { FieldValidationResult } from "@/lib/types";
import StatusBadge from "./StatusBadge";

interface FieldResultProps {
  result: FieldValidationResult;
}

const fieldColors = {
  pass: "border-emerald-200 bg-emerald-50",
  fail: "border-red-200 bg-red-50",
  review: "border-amber-200 bg-amber-50",
};

export default function FieldResult({ result }: FieldResultProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`rounded-lg border p-4 ${fieldColors[result.status]}`}>
      <div
        className="flex items-start justify-between cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <StatusBadge status={result.status} />
          <span className="font-semibold text-gray-800 text-sm">{result.field}</span>
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
          {result.extractedValue && (
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
          {result.detail && (
            <div className="text-xs text-gray-600 italic">{result.detail}</div>
          )}
        </div>
      )}
    </div>
  );
}
