"use client";

import { useState } from "react";
import { LabelValidationResult, ValidationStatus } from "@/lib/types";
import FieldResult from "./FieldResult";
import StatusBadge from "./StatusBadge";

interface ValidationPanelProps {
  result: LabelValidationResult;
  /** Index of the panel thumbnail currently highlighted on the left sidebar */
  activePanelIdx?: number;
  /** Called when the user clicks a panel thumbnail inside the panel */
  onSelectPanel?: (idx: number) => void;
  onOverride?: (status: ValidationStatus, notes: string) => void;
}

const fieldOrder = [
  "brandName",
  "classType",
  "alcoholContent",
  "netContents",
  "bottlerImporter",
  "governmentWarning",
  "countryOfOrigin",
  "prohibitedClaims",
  "fieldOfVision",
] as const;

const fieldLabels: Record<string, string> = {
  brandName: "Brand Name",
  classType: "Class / Type Designation",
  alcoholContent: "Alcohol Content",
  netContents: "Net Contents",
  bottlerImporter: "Bottler / Importer",
  governmentWarning: "Government Warning",
  countryOfOrigin: "Country of Origin",
  prohibitedClaims: "Prohibited Claims",
  fieldOfVision: "Field of Vision",
};
// fieldLabels is kept for potential future use
void fieldLabels;

const LOW_CONFIDENCE_MESSAGE = "Unable to read label";

function cleanSummaryMessage(msg: string): string {
  if (/confidence \d+%? is below/i.test(msg)) return LOW_CONFIDENCE_MESSAGE;
  if (/ocr confidence too low/i.test(msg)) return LOW_CONFIDENCE_MESSAGE;
  if (/prohibited claim detection requires ai/i.test(msg)) return LOW_CONFIDENCE_MESSAGE;
  if (/one or more potentially prohibited claims detected/i.test(msg)) return "Potentially prohibited claims detected.";
  return msg.replace(/\s*Manual TTB review required\.?/i, "").replace(/\s*Manual review recommended\.?/i, "").trim();
}

function dedupeSummaryMessages(messages: string[]): string[] {
  const seen = new Set<string>();
  return messages.filter((m) => {
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  });
}

export default function ValidationPanel({
  result,
  activePanelIdx = 0,
  onSelectPanel,
  onOverride,
}: ValidationPanelProps) {
  const [showOcr, setShowOcr] = useState(false);
  const [overrideMode, setOverrideMode] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState(0);
  const [overrideStatus, setOverrideStatus] = useState<ValidationStatus>("pass");
  const [overrideNotes, setOverrideNotes] = useState("");

  const allFields = {
    ...result.fields,
    fieldOfVision: result.fieldOfVision,
  };

  const passCount = Object.values(allFields).filter((f) => f.status === "pass").length;
  const failCount = Object.values(allFields).filter((f) => f.status === "fail").length;
  const reviewCount = Object.values(allFields).filter((f) => f.status === "review").length;
  const total = Object.values(allFields).length;

  const effectiveStatus = result.reviewerOverride?.status ?? result.overallStatus;

  const failedFields = fieldOrder
    .filter((k) => allFields[k as keyof typeof allFields]?.status === "fail")
    .map((k) => cleanSummaryMessage(allFields[k as keyof typeof allFields]!.message));

  const reviewFields = dedupeSummaryMessages(
    fieldOrder
      .filter((k) => allFields[k as keyof typeof allFields]?.status === "review")
      .map((k) => cleanSummaryMessage(allFields[k as keyof typeof allFields]!.message))
  );

  const openLightbox = (idx: number) => {
    setLightboxIdx(idx);
    setLightboxOpen(true);
  };

  // Heading: prefer brand name from matched record, otherwise fall back to filename
  const headingText =
    result.matchedApplicationData?.brandName ??
    (result.fileNames[0] ?? "Submission");

  return (
    <div className="space-y-6">
      {/* Lightbox overlay */}
      {lightboxOpen && result.imageUrls[lightboxIdx] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <div className="relative max-w-4xl max-h-full" onClick={(e) => e.stopPropagation()}>
            {/* Navigation arrows */}
            {result.imageUrls.length > 1 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setLightboxIdx((i) => (i - 1 + result.imageUrls.length) % result.imageUrls.length); }}
                  className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-12 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 text-white flex items-center justify-center transition-colors"
                >
                  ‹
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setLightboxIdx((i) => (i + 1) % result.imageUrls.length); }}
                  className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 text-white flex items-center justify-center transition-colors"
                >
                  ›
                </button>
              </>
            )}
            <button
              onClick={() => setLightboxOpen(false)}
              className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center text-gray-600 hover:text-gray-900 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <p className="absolute -bottom-8 left-0 right-0 text-center text-sm text-white/70">
              Panel {lightboxIdx + 1} of {result.imageUrls.length} · {result.fileNames[lightboxIdx]}
            </p>
            <img
              src={result.imageUrls[lightboxIdx]}
              alt={result.fileNames[lightboxIdx]}
              className="max-w-full max-h-[85vh] rounded-xl shadow-2xl object-contain"
            />
          </div>
        </div>
      )}

      {/* Overall result header */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-bold text-gray-900">
            {headingText}
          </h2>
          <StatusBadge status={result.reviewerOverride?.status ?? result.overallStatus} large />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border
            ${result.usedAi
              ? "bg-violet-50 text-violet-700 border-violet-200"
              : "bg-gray-100 text-gray-600 border-gray-200"
            }`}>
            {result.usedAi ? "✦ Claude Haiku Vision" : "Tesseract OCR (fallback)"}
          </span>
          <span className="text-sm text-gray-500">
            Confidence: <strong className={result.ocrConfidence >= 85 ? "text-emerald-600" : result.ocrConfidence >= 70 ? "text-amber-600" : "text-red-600"}>{result.ocrConfidence.toFixed(0)}%</strong>
          </span>
          <span className="text-sm text-gray-500">
            Processed in <strong>{(result.processingTimeMs / 1000).toFixed(1)}s</strong>
          </span>
        </div>
        {result.analysisNotes && (
          <p className="text-xs text-gray-500 italic">{result.analysisNotes}</p>
        )}

        {/* Panel thumbnails strip — sits below the heading so it never squeezes the title */}
        {result.imageUrls.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {result.imageUrls.map((url, i) => (
              <button
                key={i}
                onClick={() => { onSelectPanel?.(i); openLightbox(i); }}
                className={`relative w-16 h-20 rounded-lg border-2 overflow-hidden shadow-sm hover:shadow-md transition-all
                  ${activePanelIdx === i ? "border-blue-500 ring-2 ring-blue-200" : "border-gray-200 hover:border-gray-300"}`}
                title={`Panel ${i + 1}: ${result.fileNames[i]}`}
              >
                <img
                  src={url}
                  alt={result.fileNames[i]}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors" />
                {result.imageUrls.length > 1 && (
                  <span className="absolute bottom-0.5 left-0 right-0 text-center text-white text-[9px] font-bold drop-shadow">
                    {i + 1}/{result.imageUrls.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Issues summary */}
      {effectiveStatus !== "pass" && (failedFields.length > 0 || reviewFields.length > 0) && (
        <div className="rounded-lg px-4 py-3 text-sm border bg-white border-gray-200 space-y-2">
          {failedFields.length > 0 && (
            <div>
              <p className="font-semibold text-red-700 mb-1">Failed</p>
              <ul className="space-y-0.5">
                {failedFields.map((msg, i) => (
                  <li key={i} className="flex items-start gap-2 text-red-800">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                    {msg}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {reviewFields.length > 0 && (
            <div className={failedFields.length > 0 ? "pt-2 border-t border-gray-100" : ""}>
              <p className="font-semibold text-amber-700 mb-1">Needs Review</p>
              <ul className="space-y-0.5">
                {reviewFields.map((msg, i) => (
                  <li key={i} className="flex items-start gap-2 text-amber-800">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    {msg}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Application record match banner */}
      {result.unmatched ? (
        <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
          <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-semibold text-amber-800">No application record matched</p>
            <p className="text-amber-700 text-xs mt-0.5">
              No entry found in <code className="bg-amber-100 px-1 rounded">application-data.json</code> for ID{" "}
              <code className="bg-amber-100 px-1 rounded">{result.matchedApplicationId}</code>. Format-only
              validation was applied — field comparisons are skipped.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm">
          <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-semibold text-emerald-800">
              {result.matchedApplicationId === "manual"
                ? "Application data provided manually"
                : <>Matched application record: <span className="font-mono">{result.matchedApplicationId}</span></>}
            </p>
            <p className="text-emerald-700 text-xs mt-0.5">
              {result.matchedApplicationData?.brandName} · {result.matchedApplicationData?.classType} · {result.matchedApplicationData?.alcoholContent} · {result.matchedApplicationData?.netContents}
            </p>
          </div>
        </div>
      )}

      {/* Summary pills */}
      <div className="flex items-center gap-2 text-xs font-semibold">
        <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
          {passCount}/{total} Pass
        </span>
        {failCount > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-red-100 text-red-700 border border-red-200">
            {failCount} Fail
          </span>
        )}
        {reviewCount > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
            {reviewCount} Review
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden flex">
        <div className="bg-emerald-400 transition-all" style={{ width: `${(passCount / total) * 100}%` }} />
        <div className="bg-amber-400 transition-all" style={{ width: `${(reviewCount / total) * 100}%` }} />
        <div className="bg-red-400 transition-all" style={{ width: `${(failCount / total) * 100}%` }} />
      </div>

      {/* Reviewer override display */}
      {result.reviewerOverride && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
          <div className="flex items-center gap-2 font-semibold text-blue-800">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Reviewer Override Applied
          </div>
          {result.reviewerOverride.notes && (
            <p className="mt-1 text-blue-700">{result.reviewerOverride.notes}</p>
          )}
        </div>
      )}

      {/* Field results */}
      <div className="space-y-3">
        {fieldOrder.map((key) => {
          const fieldResult = allFields[key as keyof typeof allFields];
          if (!fieldResult) return null;
          return <FieldResult key={key} result={fieldResult} />;
        })}
      </div>

      {/* OCR Text toggle */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowOcr((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-sm font-semibold text-gray-700 transition-colors"
        >
          <span>Raw Extracted Text {result.panelCount > 1 ? `(${result.panelCount} panels)` : ""}</span>
          <svg
            className={`w-4 h-4 transition-transform ${showOcr ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showOcr && (
          <pre className="p-4 text-xs text-gray-600 bg-white font-mono whitespace-pre-wrap break-all overflow-auto max-h-64">
            {result.ocrText || "(No text extracted)"}
          </pre>
        )}
      </div>

      {/* Reviewer override panel */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setOverrideMode((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-sm font-semibold text-gray-700 transition-colors"
        >
          <span>Reviewer Override</span>
          <svg
            className={`w-4 h-4 transition-transform ${overrideMode ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {overrideMode && (
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-500">Override the AI determination with your professional judgment.</p>
            <div className="flex gap-2">
              {(["pass", "fail", "review"] as ValidationStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setOverrideStatus(s)}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-semibold border transition-colors capitalize
                    ${overrideStatus === s
                      ? s === "pass" ? "bg-emerald-600 text-white border-emerald-600"
                        : s === "fail" ? "bg-red-600 text-white border-red-600"
                        : "bg-amber-500 text-white border-amber-500"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }`}
                >
                  {s === "review" ? "Review" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <textarea
              rows={2}
              placeholder="Add reviewer notes (optional)…"
              value={overrideNotes}
              onChange={(e) => setOverrideNotes(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <button
              onClick={() => {
                onOverride?.(overrideStatus, overrideNotes);
                setOverrideMode(false);
              }}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Apply Override
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
