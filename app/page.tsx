"use client";

import { useState, useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import UploadZone from "@/components/UploadZone";
import ApplicationForm from "@/components/ApplicationForm";
import AppDocUpload from "@/components/AppDocUpload";
import ValidationPanel from "@/components/ValidationPanel";
import StatusBadge from "@/components/StatusBadge";
import { PanelUpload, LabelValidationResult, ValidationStatus, ApplicationData } from "@/lib/types";
import { processSubmission } from "@/lib/processor";
import { inferPanelLabel } from "@/lib/panel-utils";

type Step = "upload" | "appdata" | "processing" | "results";

const EMPTY_APP_DATA: ApplicationData = {
  brandName: "",
  classType: "",
  alcoholContent: "",
  netContents: "",
  bottlerName: "",
  bottlerCity: "",
  bottlerState: "",
  isImported: false,
  countryOfOrigin: "",
};

function isFormValid(d: ApplicationData, govWarnConfirmed: boolean): boolean {
  return (
    !!d.brandName.trim() &&
    !!d.classType.trim() &&
    !!d.alcoholContent.trim() &&
    !!d.netContents.trim() &&
    !!d.bottlerCity.trim() &&
    !!d.bottlerState.trim() &&
    (!d.isImported || !!d.countryOfOrigin.trim()) &&
    govWarnConfirmed
  );
}

export default function HomePage() {
  const [isDemoMode, setIsDemoMode] = useState(true);
  const [step, setStep] = useState<Step>("upload");
  const [panels, setPanels] = useState<PanelUpload[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<LabelValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePanelIdx, setActivePanelIdx] = useState(0);
  const [manualAppData, setManualAppData] = useState<ApplicationData>(EMPTY_APP_DATA);
  const [govWarnConfirmed, setGovWarnConfirmed] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const addFiles = useCallback((files: File[], folderName?: string) => {
    const newPanels: PanelUpload[] = files.map((file, i) => {
      // When files come from a folder, rename each file to `{folderName}{i+1}.{ext}`
      // so normalizeId strips the trailing digit and matches the registry ID.
      let effectiveFile = file;
      if (folderName) {
        const ext = file.name.split(".").pop() ?? "jpg";
        effectiveFile = new File([file], `${folderName}${i + 1}.${ext}`, { type: file.type });
      }
      // For panel label: use filename suffix when present; for folder uploads that
      // default to "Front" (no suffix), use "Panel N" instead.
      const inferred = inferPanelLabel(file.name);
      const panelLabel = folderName && inferred === "Front" ? `Panel ${i + 1}` : inferred;
      return {
        id: uuidv4(),
        file: effectiveFile,
        previewUrl: URL.createObjectURL(file),
        panelLabel,
      };
    });
    setPanels((prev) => [...prev, ...newPanels]);
  }, []);

  const removePanel = useCallback((id: string) => {
    setPanels((prev) => {
      const removed = prev.find((p) => p.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const runVerification = () => {
    if (panels.length === 0) return;
    if (!isDemoMode) {
      // In manual mode, go to the application data form first
      setStep("appdata");
      return;
    }
    startProcessing();
  };

  const startProcessing = useCallback(async (appData?: ApplicationData) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsProcessing(true);
    setError(null);
    setStep("processing");
    try {
      const submissionResult = await processSubmission(panels, undefined, appData, controller.signal);
      setResult(submissionResult);
      setActivePanelIdx(0);
      setStep("results");
    } catch (err) {
      // Silently discard aborted sessions — the UI has already been reset
      if (err instanceof Error && err.name === "AbortError") return;
      setError(String(err));
      setStep("results");
    } finally {
      setIsProcessing(false);
    }
  }, [panels]);

  const applyOverride = (status: ValidationStatus, notes: string) => {
    if (!result) return;
    setResult({
      ...result,
      reviewerOverride: { status, notes, reviewedAt: new Date().toISOString() },
    });
  };

  const reset = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    panels.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPanels([]);
    setResult(null);
    setError(null);
    setActivePanelIdx(0);
    setManualAppData(EMPTY_APP_DATA);
    setGovWarnConfirmed(false);
    setStep("upload");
    setIsProcessing(false);
  };

  const effectiveStatus = result?.reviewerOverride?.status ?? result?.overallStatus;

  const allSteps = isDemoMode
    ? ([
        { key: "upload", label: "Upload Panels" },
        { key: "processing", label: "Verify" },
        { key: "results", label: "Review Results" },
      ] as const)
    : ([
        { key: "upload", label: "Upload Panels" },
        { key: "appdata", label: "Application Data" },
        { key: "processing", label: "Verify" },
        { key: "results", label: "Review Results" },
      ] as const);

  const currentStepIdx = allSteps.findIndex((s) => s.key === step);

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 z-30 shadow-sm shrink-0">
        <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-700 flex items-center justify-center text-white font-bold text-sm">
              TTB
            </div>
            <div>
              <h1 className="font-bold text-gray-900 text-sm leading-tight">
                Alcohol Label Verification
              </h1>
              <p className="text-xs text-gray-500 leading-tight">
                AI-Assisted Compliance Review · POC v2.0
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Demo mode toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Demo</span>
              <button
                onClick={() => {
                  setIsDemoMode((v) => !v);
                  reset();
                }}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none
                  ${isDemoMode ? "bg-blue-600" : "bg-gray-300"}`}
                title={isDemoMode ? "Demo mode on — switch to manual entry" : "Manual entry mode — switch to demo"}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform
                    ${isDemoMode ? "translate-x-4.5" : "translate-x-0.5"}`}
                />
              </button>
            </div>

            {step !== "upload" && (
              <button
                onClick={reset}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                New Session
              </button>
            )}
          </div>
        </div>

        {/* Step indicator */}
        <div className="max-w-screen-xl mx-auto px-6 pb-3">
          <div className="flex items-center gap-2">
            {allSteps.map(({ key, label }, i) => (
              <div key={key} className="flex items-center gap-2 flex-1">
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                    ${i < currentStepIdx ? "bg-blue-600 text-white"
                      : i === currentStepIdx ? "bg-blue-600 text-white ring-4 ring-blue-100"
                      : "bg-gray-200 text-gray-500"}
                  `}>
                    {i < currentStepIdx ? "✓" : i + 1}
                  </div>
                  <span className={`text-xs font-medium hidden sm:block transition-colors ${i <= currentStepIdx ? "text-blue-700" : "text-gray-400"}`}>
                    {label}
                  </span>
                </div>
                {i < allSteps.length - 1 && (
                  <div className={`flex-1 h-0.5 rounded-full transition-colors ${i < currentStepIdx ? "bg-blue-400" : "bg-gray-200"}`} />
                )}
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 max-w-screen-xl mx-auto w-full px-6 py-8 flex flex-col overflow-hidden">

        {/* ── Step: Upload ──────────────────────────────────────────── */}
        {step === "upload" && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="max-w-2xl mx-auto">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Upload Label Panels</h2>
                <p className="text-gray-500 mt-1">
                  Upload <strong>all panels</strong> for a single application — front, back, neck, cap, and any
                  other surfaces. All images are analyzed together as one submission. Name files using the
                  application ID with an optional panel suffix (e.g.{" "}
                  <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded border">TTB-2024-001_front.jpg</code>,{" "}
                  <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded border">TTB-2024-001_back.jpg</code>).
                </p>
              </div>

              <UploadZone onFilesAdded={addFiles} />

              {panels.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-700">
                      {panels.length} panel{panels.length !== 1 ? "s" : ""} queued
                    </h3>
                    <button
                      onClick={() => { panels.forEach((p) => URL.revokeObjectURL(p.previewUrl)); setPanels([]); }}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Clear all
                    </button>
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {panels.map((panel) => (
                      <PanelCard key={panel.id} panel={panel} onRemove={removePanel} />
                    ))}
                  </div>

                  <button
                    onClick={runVerification}
                    className="mt-6 w-full py-3.5 bg-blue-700 hover:bg-blue-800 text-white font-semibold rounded-xl shadow transition-colors text-base"
                  >
                    {isDemoMode
                      ? `Run Verification (${panels.length} panel${panels.length !== 1 ? "s" : ""}) →`
                      : `Continue to Application Data (${panels.length} panel${panels.length !== 1 ? "s" : ""}) →`}
                  </button>
                </div>
              )}

              {panels.length === 0 && (
                <div className="mt-8 space-y-3">
                  <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-800">
                    <strong>How it works:</strong> Upload all label panels for one TTB application at once —
                    front, back, neck, cap, etc. The system analyzes every surface together in a single
                    AI pass, so required elements like the government warning (usually on the back) or
                    the bottler statement are never missed.
                  </div>
                  {isDemoMode ? (
                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-600">
                      <strong>Folder upload (recommended):</strong> place all panel images inside a folder
                      named after the application ID (e.g.{" "}
                      <code className="bg-gray-100 px-1 rounded">blackHollowLabel/</code>) and drag the
                      folder here or use <strong>Select Folder</strong>. Alternatively, name individual files
                      with the application ID as a prefix (e.g.{" "}
                      <code className="bg-gray-100 px-1 rounded">blackHollowLabel_front.png</code>).
                    </div>
                  ) : (
                    <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-800">
                      <strong>Manual entry mode:</strong> after uploading panels you will fill out the
                      application data (brand name, class/type, alcohol content, etc.) before verification runs.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step: Application Data (manual mode only) ───────────────── */}
        {step === "appdata" && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="max-w-2xl mx-auto">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Application Data</h2>
                  <p className="text-gray-500 mt-1">
                    Enter the filed application data to compare against the uploaded label panels.
                    Fields marked <span className="text-red-500 font-semibold">*</span> are required.
                  </p>
                </div>
                <button
                  onClick={() => setStep("upload")}
                  className="shrink-0 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  ← Back
                </button>
              </div>

              {/* AI document pre-fill */}
              <div className="mb-4">
                <AppDocUpload
                  onExtracted={(data) => {
                    setManualAppData((prev) => ({
                      ...prev,
                      ...Object.fromEntries(
                        Object.entries(data).filter(([, v]) => v !== "" && v !== null && v !== undefined)
                      ),
                    }));
                  }}
                />
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <ApplicationForm
                  data={manualAppData}
                  onChange={setManualAppData}
                  govWarnConfirmed={govWarnConfirmed}
                  onGovWarnConfirmedChange={setGovWarnConfirmed}
                />
              </div>

              <button
                onClick={() => startProcessing(manualAppData)}
                disabled={!isFormValid(manualAppData, govWarnConfirmed)}
                className="mt-6 w-full py-3.5 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow transition-colors text-base"
              >
                Run Verification →
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Processing ────────────────────────────────────────── */}
        {step === "processing" && (
          <div className="flex-1 flex items-center justify-center">
            <div className="bg-white rounded-xl border border-gray-200 p-12 shadow-sm flex flex-col items-center gap-6 max-w-md w-full">
              <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <div className="text-center">
                <p className="font-semibold text-gray-700 text-lg">
                  Analyzing {panels.length} panel{panels.length !== 1 ? "s" : ""}…
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  Looking up application record · Running AI analysis across all surfaces · Validating TTB compliance…
                </p>
              </div>
              <div className="w-full space-y-2">
                {panels.map((panel, i) => (
                  <div key={panel.id} className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg border border-gray-200 overflow-hidden shrink-0 bg-gray-50">
                      {panel.file.type !== "application/pdf" ? (
                        <img src={panel.previewUrl} alt={panel.file.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs font-bold">PDF</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-700 truncate">{panel.panelLabel}</p>
                      <p className="text-xs text-gray-400 truncate">{panel.file.name}</p>
                    </div>
                    <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0"
                      style={{ animationDelay: `${i * 150}ms` }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Step: Results ───────────────────────────────────────────── */}
        {step === "results" && (
          <div className="flex gap-6 flex-1 min-h-0">
            {/* Left: panel strip */}
            <div className="w-64 shrink-0 flex flex-col gap-4 overflow-y-auto pr-1">
              <div>
                <h3 className="font-bold text-gray-900 text-sm mb-1">
                  Submission Panels ({panels.length})
                </h3>
                {result && (
                  <div className="flex items-center gap-2 mt-1">
                    <StatusBadge status={effectiveStatus!} large />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {panels.map((panel, i) => (
                  <button
                    key={panel.id}
                    onClick={() => setActivePanelIdx(i)}
                    className={`w-full flex items-center gap-3 p-2 rounded-xl border-2 transition-all text-left
                      ${activePanelIdx === i
                        ? "border-blue-500 bg-blue-50 shadow-sm"
                        : "border-gray-200 bg-white hover:border-gray-300"
                      }`}
                  >
                    <div className="w-12 h-14 rounded-lg border border-gray-200 overflow-hidden shrink-0 bg-gray-50">
                      {panel.file.type !== "application/pdf" ? (
                        <img src={panel.previewUrl} alt={panel.file.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs font-bold">PDF</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{panel.panelLabel}</p>
                      <p className="text-xs text-gray-400 truncate">{panel.file.name}</p>
                    </div>
                  </button>
                ))}
              </div>

              <button
                onClick={reset}
                className="w-full py-2.5 border border-gray-300 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors"
              >
                New Session
              </button>
            </div>

            {/* Right: validation result */}
            <div className="flex-1 min-w-0 overflow-y-auto">
              {result ? (
                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                  <ValidationPanel
                    result={result}
                    activePanelIdx={activePanelIdx}
                    onSelectPanel={setActivePanelIdx}
                    onOverride={applyOverride}
                  />
                </div>
              ) : error ? (
                <div className="bg-white rounded-xl border border-red-200 p-8 shadow-sm">
                  <div className="flex items-start gap-3 text-red-700">
                    <svg className="w-6 h-6 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="font-semibold">Processing Error</p>
                      <p className="text-sm mt-1 text-red-600">{error}</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Inline panel thumbnail card for step 1 upload queue ──────────────────────

function PanelCard({ panel, onRemove }: { panel: PanelUpload; onRemove: (id: string) => void }) {
  const isPdf = panel.file.type === "application/pdf";

  return (
    <div className="relative rounded-xl border-2 border-gray-200 overflow-hidden bg-white">
      <button
        onClick={() => onRemove(panel.id)}
        className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-gray-800/60 hover:bg-red-600 text-white flex items-center justify-center text-xs transition-colors"
        title="Remove"
      >
        ✕
      </button>

      <div className="aspect-[3/4] bg-gray-100 flex items-center justify-center overflow-hidden">
        {isPdf ? (
          <div className="flex flex-col items-center gap-2 text-gray-400">
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <span className="text-xs font-medium">PDF</span>
          </div>
        ) : (
          <img src={panel.previewUrl} alt={panel.file.name} className="w-full h-full object-contain" />
        )}
      </div>

      <div className="p-2 border-t border-gray-100 bg-gray-50">
        <p className="text-xs font-semibold text-blue-700 truncate">{panel.panelLabel}</p>
        <p className="text-xs text-gray-500 truncate" title={panel.file.name}>{panel.file.name}</p>
        <p className="text-xs text-gray-400 mt-0.5">{(panel.file.size / 1024).toFixed(0)} KB</p>
      </div>
    </div>
  );
}
