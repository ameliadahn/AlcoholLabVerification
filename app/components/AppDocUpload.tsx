"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { ApplicationData } from "@/lib/types";

interface AppDocUploadProps {
  onExtracted: (data: ApplicationData, confidence: number, notes: string) => void;
}

type State =
  | { status: "idle" }
  | { status: "extracting"; fileName: string }
  | { status: "done"; fileName: string; confidence: number; notes: string }
  | { status: "error"; message: string };

async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const [meta, base64] = dataUrl.split(",");
      const mimeType = meta.replace("data:", "").replace(";base64", "");
      resolve({ base64, mimeType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function AppDocUpload({ onExtracted }: AppDocUploadProps) {
  const [state, setState] = useState<State>({ status: "idle" });

  const processFile = useCallback(
    async (file: File) => {
      setState({ status: "extracting", fileName: file.name });
      try {
        const { base64, mimeType } = await fileToBase64(file);
        const res = await fetch("/api/extract-app-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64, mimeType }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Extraction failed.");
        setState({
          status: "done",
          fileName: file.name,
          confidence: data.confidence,
          notes: data.notes,
        });
        onExtracted(data.applicationData, data.confidence, data.notes);
      } catch (err) {
        setState({ status: "error", message: String(err) });
      }
    },
    [onExtracted]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => { if (files[0]) processFile(files[0]); },
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
    },
    maxFiles: 1,
    maxSize: 20 * 1024 * 1024,
    disabled: state.status === "extracting",
  });

  const reset = () => setState({ status: "idle" });

  // ── Done state ────────────────────────────────────────────────────────────
  if (state.status === "done") {
    const { confidence, notes, fileName } = state;
    const confidenceColor =
      confidence >= 85 ? "text-emerald-600" : confidence >= 70 ? "text-amber-600" : "text-red-600";
    const badgeBg =
      confidence >= 85 ? "bg-emerald-50 border-emerald-200" : confidence >= 70 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200";

    return (
      <div className={`rounded-xl border-2 p-4 ${badgeBg}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0
              ${confidence >= 85 ? "bg-emerald-100" : confidence >= 70 ? "bg-amber-100" : "bg-red-100"}`}>
              <svg className={`w-4 h-4 ${confidenceColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">
                Fields pre-filled from <span className="font-mono text-xs">{fileName}</span>
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                AI confidence: <span className={`font-semibold ${confidenceColor}`}>{confidence}%</span>
                {" — "}review all fields below before continuing
              </p>
            </div>
          </div>
          <button
            onClick={reset}
            className="shrink-0 text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Replace
          </button>
        </div>
        {notes && (
          <p className="mt-2.5 text-xs text-gray-500 italic border-t border-current/10 pt-2">
            {notes}
          </p>
        )}
      </div>
    );
  }

  // ── Extracting state ──────────────────────────────────────────────────────
  if (state.status === "extracting") {
    return (
      <div className="rounded-xl border-2 border-violet-200 bg-violet-50 px-4 py-3 flex items-center gap-3">
        <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin shrink-0" />
        <div>
          <p className="text-sm font-semibold text-violet-800">Extracting application data…</p>
          <p className="text-xs text-violet-600 truncate">{state.fileName}</p>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (state.status === "error") {
    return (
      <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-red-800">Extraction failed</p>
            <p className="text-xs text-red-700 mt-0.5">{state.message}</p>
          </div>
        </div>
        <button onClick={reset} className="shrink-0 text-xs text-red-500 hover:text-red-700 underline">
          Try again
        </button>
      </div>
    );
  }

  // ── Idle / drop target ────────────────────────────────────────────────────
  return (
    <div
      {...getRootProps()}
      className={`rounded-xl border-2 border-dashed px-5 py-4 flex items-center gap-4 cursor-pointer transition-all
        ${isDragActive
          ? "border-violet-400 bg-violet-50"
          : "border-gray-200 bg-gray-50 hover:border-violet-300 hover:bg-violet-50/50"}`}
    >
      <input {...getInputProps()} />
      <div className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center
        ${isDragActive ? "bg-violet-100" : "bg-white border border-gray-200"}`}>
        <svg className={`w-5 h-5 ${isDragActive ? "text-violet-500" : "text-gray-400"}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <div>
        <p className={`text-sm font-semibold ${isDragActive ? "text-violet-700" : "text-gray-700"}`}>
          {isDragActive ? "Drop application document here" : "Upload application document to auto-fill"}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          Drop a JPG or PNG of the COLA application · AI will pre-fill the fields below for your review
        </p>
      </div>
    </div>
  );
}
