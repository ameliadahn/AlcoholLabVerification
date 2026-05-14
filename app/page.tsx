"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import UploadZone from "@/components/UploadZone";
import ApplicationForm from "@/components/ApplicationForm";
import AppDocUpload from "@/components/AppDocUpload";
import AppDataImporter from "@/components/AppDataImporter";
import BatchUploadZone from "@/components/BatchUploadZone";
import BatchResultsPanel from "@/components/BatchResultsPanel";
import ValidationPanel from "@/components/ValidationPanel";
import StatusBadge from "@/components/StatusBadge";
import {
  PanelUpload,
  LabelValidationResult,
  ValidationStatus,
  ApplicationData,
  BatchLabelSubmission,
} from "@/lib/types";
import { processSubmission } from "@/lib/processor";
import { inferPanelLabel } from "@/lib/panel-utils";
import { useBatchQueue } from "@/lib/useBatchQueue";
import { matchRecordsToLabels, ParsedApplicationRecord } from "@/lib/app-data-parser";

// ── Types ─────────────────────────────────────────────────────────────────────

type AppMode = "single" | "batch";
type SingleStep = "upload" | "appdata" | "processing" | "results";
type BatchStep = "upload" | "manifest" | "processing";

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function HomePage() {
  // ── Shared state ────────────────────────────────────────────────────────────
  const [appMode, setAppMode] = useState<AppMode>("single");

  // ── Single-label state ───────────────────────────────────────────────────────
  const [singleStep, setSingleStep] = useState<SingleStep>("upload");
  const [panels, setPanels] = useState<PanelUpload[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<LabelValidationResult | null>(null);
  const [singleError, setSingleError] = useState<string | null>(null);
  const [activePanelIdx, setActivePanelIdx] = useState(0);
  const [manualAppData, setManualAppData] = useState<ApplicationData>(EMPTY_APP_DATA);
  const [govWarnConfirmed, setGovWarnConfirmed] = useState(false);
  const singleAbortRef = useRef<AbortController | null>(null);

  // ── Batch state ──────────────────────────────────────────────────────────────
  const [batchStep, setBatchStep] = useState<BatchStep>("upload");
  const [detectedSubmissions, setDetectedSubmissions] = useState<BatchLabelSubmission[]>([]);
  const [manifestRecords, setManifestRecords] = useState<ParsedApplicationRecord[] | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const { submissions: queueSubmissions, isRunning, stats, startBatch, abortBatch, resetBatch, applyOverride } =
    useBatchQueue();

  // ── Batch elapsed-time timer (lives here so it never unmounts mid-batch) ────
  const [batchElapsedMs, setBatchElapsedMs] = useState(0);
  const batchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const batchTimerStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRunning) {
      if (batchTimerStartRef.current === null) {
        const now = Date.now();
        batchTimerStartRef.current = now;
        setBatchElapsedMs(0);
        batchTimerRef.current = setInterval(() => {
          setBatchElapsedMs(Date.now() - batchTimerStartRef.current!);
        }, 1000);
      }
    } else {
      if (batchTimerRef.current !== null) {
        clearInterval(batchTimerRef.current);
        batchTimerRef.current = null;
      }
    }
  }, [isRunning]);

  // ── Single-label handlers ────────────────────────────────────────────────────

  const addFiles = useCallback((files: File[], folderName?: string) => {
    const newPanels: PanelUpload[] = files.map((file, i) => {
      let effectiveFile = file;
      if (folderName) {
        const ext = file.name.split(".").pop() ?? "jpg";
        effectiveFile = new File([file], `${folderName}${i + 1}.${ext}`, { type: file.type });
      }
      const inferred = inferPanelLabel(file.name);
      const panelLabel = folderName && inferred === "Front" ? `Panel ${i + 1}` : inferred;
      return { id: uuidv4(), file: effectiveFile, previewUrl: URL.createObjectURL(file), panelLabel };
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
    setSingleStep("appdata");
  };

  const startSingleProcessing = useCallback(
    async (appData?: ApplicationData) => {
      const controller = new AbortController();
      singleAbortRef.current = controller;
      setIsProcessing(true);
      setSingleError(null);
      setSingleStep("processing");
      try {
        const submissionResult = await processSubmission(panels, undefined, appData, controller.signal);
        setResult(submissionResult);
        setActivePanelIdx(0);
        setSingleStep("results");
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setSingleError(String(err));
        setSingleStep("results");
      } finally {
        setIsProcessing(false);
      }
    },
    [panels]
  );

  const applyOverrideSingle = (status: ValidationStatus, notes: string) => {
    if (!result) return;
    setResult({ ...result, reviewerOverride: { status, notes, reviewedAt: new Date().toISOString() } });
  };

  const resetSingle = () => {
    singleAbortRef.current?.abort();
    singleAbortRef.current = null;
    panels.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPanels([]);
    setResult(null);
    setSingleError(null);
    setActivePanelIdx(0);
    setManualAppData(EMPTY_APP_DATA);
    setGovWarnConfirmed(false);
    setSingleStep("upload");
    setIsProcessing(false);
  };

  // ── Batch handlers ───────────────────────────────────────────────────────────

  const handleSubmissionsAdded = useCallback((newSubs: BatchLabelSubmission[]) => {
    setDetectedSubmissions((prev) => [...prev, ...newSubs]);
  }, []);

  const removeDetectedSubmission = useCallback((id: string) => {
    setDetectedSubmissions((prev) => {
      const removed = prev.find((s) => s.id === id);
      if (removed) removed.panels.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  const proceedToBatchManifest = () => setBatchStep("manifest");

  const BATCH_LIMIT = 15;

  const startBatchProcessing = () => {
    setBatchError(null);
    // Cap at BATCH_LIMIT — take the first N submissions in the queue.
    let submissionsToRun = detectedSubmissions.slice(0, BATCH_LIMIT);

    try {
      // Attach applicationData from the uploaded manifest records.
      if (manifestRecords && manifestRecords.length > 0) {
        const labels = submissionsToRun.map((s) => s.submissionLabel);
        const appDataList = matchRecordsToLabels(manifestRecords, labels);
        submissionsToRun = submissionsToRun.map((s, i) => ({
          ...s,
          applicationData: appDataList[i],
        }));
      }
    } catch (err) {
      setBatchError(
        err instanceof Error
          ? err.message
          : "Failed to match manifest records to labels. Please check your spreadsheet."
      );
      return;
    }

    setBatchStep("processing");
    startBatch(submissionsToRun);
  };

  const resetBatchFlow = () => {
    abortBatch();
    detectedSubmissions.forEach((s) => s.panels.forEach((p) => URL.revokeObjectURL(p.previewUrl)));
    setDetectedSubmissions([]);
    setManifestRecords(null);
    setBatchStep("upload");
    resetBatch();
    if (batchTimerRef.current !== null) clearInterval(batchTimerRef.current);
    batchTimerRef.current = null;
    batchTimerStartRef.current = null;
    setBatchElapsedMs(0);
  };

  // ── Mode switch ──────────────────────────────────────────────────────────────

  const switchMode = (mode: AppMode) => {
    if (mode === appMode) return;
    resetSingle();
    resetBatchFlow();
    setAppMode(mode);
  };

  // ── Derived ──────────────────────────────────────────────────────────────────

  const effectiveStatus = result?.reviewerOverride?.status ?? result?.overallStatus;

  const singleAllSteps = [
    { key: "upload", label: "Upload Panels" },
    { key: "appdata", label: "Application Data" },
    { key: "processing", label: "Verify" },
    { key: "results", label: "Review Results" },
  ] as const;

  const batchAllSteps = [
    { key: "upload", label: "Upload Labels" },
    { key: "manifest", label: "Application Data" },
    { key: "processing", label: "Process Batch" },
  ] as const;

  const currentSingleStepIdx = singleAllSteps.findIndex((s) => s.key === singleStep);
  const currentBatchStepIdx = batchAllSteps.findIndex((s) => s.key === batchStep);

  const activeSteps = appMode === "single" ? singleAllSteps : batchAllSteps;
  const currentStepIdx = appMode === "single" ? currentSingleStepIdx : currentBatchStepIdx;

  const showNewSession =
    (appMode === "single" && singleStep !== "upload") ||
    (appMode === "batch" && batchStep !== "upload");

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
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
            {/* Single / Batch mode toggle */}
            <div className="flex items-center rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              {(["single", "batch"] as AppMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors capitalize
                    ${appMode === m
                      ? "bg-white text-blue-700 shadow-sm border border-gray-200"
                      : "text-gray-500 hover:text-gray-700"
                    }`}
                >
                  {m === "single" ? "Single Label" : "Batch"}
                </button>
              ))}
            </div>

            {showNewSession && (
              <button
                onClick={appMode === "single" ? resetSingle : resetBatchFlow}
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
            {activeSteps.map(({ key, label }, i) => (
              <div key={key} className="flex items-center gap-2 flex-1">
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                    ${i < currentStepIdx ? "bg-blue-600 text-white"
                      : i === currentStepIdx ? "bg-blue-600 text-white ring-4 ring-blue-100"
                      : "bg-gray-200 text-gray-500"}
                  `}>
                    {i < currentStepIdx ? "✓" : i + 1}
                  </div>
                  <span className={`text-xs font-medium hidden sm:block transition-colors
                    ${i <= currentStepIdx ? "text-blue-700" : "text-gray-400"}`}>
                    {label}
                  </span>
                </div>
                {i < activeSteps.length - 1 && (
                  <div className={`flex-1 h-0.5 rounded-full transition-colors
                    ${i < currentStepIdx ? "bg-blue-400" : "bg-gray-200"}`} />
                )}
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <main className="flex-1 min-h-0 max-w-screen-xl mx-auto w-full px-6 py-8 flex flex-col overflow-hidden">

        {/* ════════════════════════════════════════════════════════
            SINGLE-LABEL FLOW
            ════════════════════════════════════════════════════════ */}
        {appMode === "single" && (
          <>
            {/* Upload */}
            {singleStep === "upload" && (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="max-w-2xl mx-auto">
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold text-gray-900">Upload Label Panels</h2>
                    <p className="text-gray-500 mt-1">
                      Upload <strong>all panels</strong> for a single application — front, back, neck, cap, and any
                      other surfaces. Name files using the application ID with an optional panel suffix (e.g.{" "}
                      <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded border">TTB-2024-001_front.jpg</code>).
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
                        Continue to Application Data →
                      </button>
                    </div>
                  )}

                  {panels.length === 0 && (
                    <div className="mt-8 space-y-3">
                      <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-800">
                        <strong>How it works:</strong> Upload all label panels for one TTB application at once.
                        The system analyzes every surface together in a single AI pass.
                      </div>
                      <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-800">
                        After uploading panels you will fill out the application data before verification runs.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Application Data (manual mode only) */}
            {singleStep === "appdata" && (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="max-w-2xl mx-auto">
                  <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900">Application Data</h2>
                      <p className="text-gray-500 mt-1">
                        Enter the filed application data to compare against the uploaded label panels.
                      </p>
                    </div>
                    <button
                      onClick={() => setSingleStep("upload")}
                      className="shrink-0 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      ← Back
                    </button>
                  </div>

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
                    onClick={() => startSingleProcessing(manualAppData)}
                    disabled={!isFormValid(manualAppData, govWarnConfirmed)}
                    className="mt-6 w-full py-3.5 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow transition-colors text-base"
                  >
                    Run Verification →
                  </button>
                </div>
              </div>
            )}

            {/* Processing */}
            {singleStep === "processing" && (
              <div className="flex-1 flex items-center justify-center">
                <div className="bg-white rounded-xl border border-gray-200 p-12 shadow-sm flex flex-col items-center gap-6 max-w-md w-full">
                  <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <div className="text-center">
                    <p className="font-semibold text-gray-700 text-lg">
                      Analyzing {panels.length} panel{panels.length !== 1 ? "s" : ""}…
                    </p>
                    <p className="text-sm text-gray-500 mt-2">
                      Looking up application record · Running AI analysis · Validating TTB compliance…
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

            {/* Results */}
            {singleStep === "results" && (
              <div className="flex gap-6 flex-1 min-h-0">
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
                    onClick={resetSingle}
                    className="w-full py-2.5 border border-gray-300 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    New Session
                  </button>
                </div>

                <div className="flex-1 min-w-0 overflow-y-auto">
                  {result ? (
                    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                      <ValidationPanel
                        result={result}
                        activePanelIdx={activePanelIdx}
                        onSelectPanel={setActivePanelIdx}
                        onOverride={applyOverrideSingle}
                      />
                    </div>
                  ) : singleError ? (
                    <div className="bg-white rounded-xl border border-red-200 p-8 shadow-sm">
                      <div className="flex items-start gap-3 text-red-700">
                        <svg className="w-6 h-6 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <p className="font-semibold">Processing Error</p>
                          <p className="text-sm mt-1 text-red-600">{singleError}</p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════════════
            BATCH FLOW
            ════════════════════════════════════════════════════════ */}
        {appMode === "batch" && (
          <>
            {/* Step 1: Upload label folders */}
            {batchStep === "upload" && (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="max-w-3xl mx-auto">
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold text-gray-900">Upload Label Folders</h2>
                    <p className="text-gray-500 mt-1">
                      Drag and drop multiple folders at once — each folder should contain all panels for one label
                      (front, back, neck, cap, etc.). The folder name is used as the application ID.
                    </p>
                  </div>

                  <BatchUploadZone
                    onSubmissionsAdded={handleSubmissionsAdded}
                    disabled={isRunning}
                  />

                  {detectedSubmissions.length > 0 && (
                    <div className="mt-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-gray-700">
                          {detectedSubmissions.length} label{detectedSubmissions.length !== 1 ? "s" : ""} detected
                          {detectedSubmissions.length > BATCH_LIMIT && (
                            <span className="ml-2 text-xs font-normal text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                              first {BATCH_LIMIT} will be processed
                            </span>
                          )}
                        </h3>
                        <button
                          onClick={() => {
                            detectedSubmissions.forEach((s) => s.panels.forEach((p) => URL.revokeObjectURL(p.previewUrl)));
                            setDetectedSubmissions([]);
                          }}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Clear all
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
                        {detectedSubmissions.map((sub) => (
                          <SubmissionCard
                            key={sub.id}
                            submission={sub}
                            onRemove={removeDetectedSubmission}
                          />
                        ))}
                      </div>

                      <button
                        onClick={proceedToBatchManifest}
                        className="w-full py-3.5 bg-blue-700 hover:bg-blue-800 text-white font-semibold rounded-xl shadow transition-colors text-base"
                      >
                        {(() => {
                          const count = Math.min(detectedSubmissions.length, BATCH_LIMIT);
                          const label = `${count} label${count !== 1 ? "s" : ""}`;
                          return `Continue to Application Data (${label}) →`;
                        })()}
                      </button>
                    </div>
                  )}

                  {detectedSubmissions.length === 0 && (
                    <div className="mt-6 space-y-2">
                      <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-800">
                        <strong>How to organize your files:</strong> Put each label&apos;s panel images in its own
                        folder named after the application ID (e.g.{" "}
                        <code className="bg-blue-100 px-1 rounded">blackHollowLabel/</code>). Then either:
                        <ul className="mt-1.5 ml-4 list-disc space-y-0.5">
                          <li>Drag <strong>multiple label folders</strong> at once</li>
                          <li>Drag or select a <strong>parent folder</strong> that contains all your label folders — each subfolder becomes one submission</li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Manifest upload (manual mode only) */}
            {batchStep === "manifest" && (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="max-w-2xl mx-auto">
                  <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900">Application Data</h2>
                      <p className="text-gray-500 mt-1">
                        Upload a spreadsheet with one row per label. Records are matched to submissions
                        by a <code className="text-xs bg-gray-100 px-1 rounded">filename</code> column or
                        by position (Row 1 → Label 1, etc.).
                      </p>
                    </div>
                    <button
                      onClick={() => setBatchStep("upload")}
                      className="shrink-0 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      ← Back
                    </button>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                    <AppDataImporter
                      labelCount={detectedSubmissions.length}
                      onImport={(records) => setManifestRecords(records)}
                      onClear={() => setManifestRecords(null)}
                    />
                  </div>

                  {batchError && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                      {batchError}
                    </div>
                  )}

                  <button
                    onClick={startBatchProcessing}
                    disabled={!manifestRecords || manifestRecords.length === 0}
                    className="mt-6 w-full py-3.5 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow transition-colors text-base"
                  >
                    Run Batch Verification ({detectedSubmissions.length} label{detectedSubmissions.length !== 1 ? "s" : ""}) →
                  </button>

                  {!manifestRecords && (
                    <p className="mt-3 text-xs text-center text-gray-400">
                      Upload a manifest file above to enable batch verification
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Step 3: Processing + live results */}
            {batchStep === "processing" && (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <BatchResultsPanel
                  submissions={queueSubmissions}
                  stats={stats}
                  isRunning={isRunning}
                  elapsedMs={batchElapsedMs}
                  onAbort={abortBatch}
                  onOverride={applyOverride}
                />

                {!isRunning && stats.total > 0 && (
                  <div className="mt-4 flex justify-center">
                    <button
                      onClick={resetBatchFlow}
                      className="px-5 py-2.5 border border-gray-300 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      New Batch Session
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ── Inline helper components ──────────────────────────────────────────────────

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

function SubmissionCard({
  submission,
  onRemove,
}: {
  submission: BatchLabelSubmission;
  onRemove: (id: string) => void;
}) {
  const firstPanel = submission.panels[0];
  const isPdf = firstPanel?.file.type === "application/pdf";

  return (
    <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
      <div className="w-12 h-14 rounded-lg border border-gray-200 overflow-hidden shrink-0 bg-gray-100">
        {firstPanel && !isPdf ? (
          <img src={firstPanel.previewUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-[10px] font-bold">
            {isPdf ? "PDF" : "—"}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate" title={submission.submissionLabel}>
          {submission.submissionLabel}
        </p>
        <p className="text-xs text-gray-500">
          {submission.panels.length} panel{submission.panels.length !== 1 ? "s" : ""}
        </p>
      </div>
      <button
        onClick={() => onRemove(submission.id)}
        className="w-6 h-6 rounded-full bg-gray-100 hover:bg-red-100 text-gray-400 hover:text-red-600 flex items-center justify-center text-xs transition-colors shrink-0"
        title="Remove"
      >
        ✕
      </button>
    </div>
  );
}
