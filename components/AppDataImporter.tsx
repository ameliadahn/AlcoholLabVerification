"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { parseApplicationDataFile, AppDataParseResult, ParsedApplicationRecord } from "@/lib/app-data-parser";
import { ApplicationData } from "@/lib/types";

interface AppDataImporterProps {
  labelCount: number;
  onImport: (records: ParsedApplicationRecord[]) => void;
}

const ACCEPTED_FORMATS = {
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-excel": [".xls"],
  "application/json": [".json"],
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
};

const FORMAT_LABELS: Record<string, string> = {
  csv: "CSV Spreadsheet",
  excel: "Excel Workbook",
  json: "JSON",
  pdf: "PDF Form",
  text: "Plain Text",
};

const FIELD_DISPLAY: { key: keyof ApplicationData; label: string }[] = [
  { key: "brandName", label: "Brand Name" },
  { key: "classType", label: "Class / Type" },
  { key: "alcoholContent", label: "Alcohol Content" },
  { key: "netContents", label: "Net Contents" },
  { key: "bottlerName", label: "Bottler Name" },
  { key: "bottlerCity", label: "City" },
  { key: "bottlerState", label: "State" },
  { key: "isImported", label: "Imported?" },
  { key: "countryOfOrigin", label: "Country of Origin" },
];

export default function AppDataImporter({ labelCount, onImport }: AppDataImporterProps) {
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<AppDataParseResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeRow, setActiveRow] = useState(0);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setFileName(file.name);
    setParsing(true);
    setResult(null);
    setError(null);

    try {
      const parsed = await parseApplicationDataFile(file);
      setResult(parsed);
      setActiveRow(0);
    } catch (err) {
      setError(`Failed to parse file: ${err}`);
    } finally {
      setParsing(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FORMATS,
    maxFiles: 1,
    disabled: parsing,
  });

  const handleConfirm = () => {
    if (result?.records.length) {
      onImport(result.records);
    }
  };

  const clearImport = () => {
    setResult(null);
    setFileName(null);
    setError(null);
  };

  const displayRecord = result?.records[activeRow];
  const multiRow = (result?.records.length ?? 0) > 1;

  return (
    <div className="space-y-5">
      {/* Drop zone */}
      {!result && (
        <div
          {...getRootProps()}
          className={`
            border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-200
            ${isDragActive ? "border-blue-400 bg-blue-50" : "border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50"}
            ${parsing ? "opacity-60 cursor-wait" : ""}
          `}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-3">
            {parsing ? (
              <>
                <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-blue-600 font-semibold">Parsing {fileName}…</p>
                <p className="text-sm text-gray-500">Extracting application data fields</p>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full bg-indigo-50 flex items-center justify-center">
                  <svg className="w-7 h-7 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-800">Upload Application Data File</p>
                  <p className="text-sm text-gray-500 mt-0.5">Drop a file here or click to browse</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2 mt-1">
                  {["CSV", "Excel (.xlsx)", "JSON", "PDF", "TXT"].map((fmt) => (
                    <span key={fmt} className="px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium border border-gray-200">
                      {fmt}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Parse error */}
      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-semibold">Parse Error</p>
            <p className="mt-0.5">{error}</p>
            <button onClick={clearImport} className="mt-2 text-red-600 underline text-xs">Try a different file</button>
          </div>
        </div>
      )}

      {/* Parse result */}
      {result && (
        <div className="space-y-4">
          {/* File summary banner */}
          <div className="flex items-center justify-between px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-indigo-900 text-sm">{fileName}</p>
                <p className="text-xs text-indigo-600">
                  {FORMAT_LABELS[result.format]} · {result.records.length} record{result.records.length !== 1 ? "s" : ""} parsed
                  {multiRow && ` · matched to ${Math.min(result.records.length, labelCount)} of ${labelCount} label${labelCount !== 1 ? "s" : ""}`}
                </p>
              </div>
            </div>
            <button
              onClick={clearImport}
              className="text-xs text-indigo-500 hover:text-indigo-700 underline"
            >
              Change file
            </button>
          </div>

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs font-semibold text-amber-800 mb-1">Parse Warnings</p>
              <ul className="space-y-0.5">
                {result.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                    <span className="mt-0.5 shrink-0">⚠</span>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Multi-row tabs */}
          {multiRow && (
            <div>
              <p className="text-xs text-gray-500 mb-2 font-medium">Preview records:</p>
              <div className="flex flex-wrap gap-1.5">
                {result.records.map((rec, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveRow(i)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors
                      ${activeRow === i
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                      }`}
                  >
                    {rec.brandName || `Record ${i + 1}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Parsed fields preview */}
          {displayRecord && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                <p className="text-xs font-semibold text-gray-600">
                  {multiRow ? `Record ${activeRow + 1} preview` : "Parsed fields"} — verify before proceeding
                </p>
              </div>
              <div className="divide-y divide-gray-100">
                {FIELD_DISPLAY.map(({ key, label }) => {
                  const val = displayRecord[key];
                  const isEmpty = val === "" || val === false || val === undefined || val === null;
                  return (
                    <div key={key} className="flex items-center px-4 py-2.5 gap-4">
                      <span className="w-36 shrink-0 text-xs font-semibold text-gray-500">{label}</span>
                      {isEmpty ? (
                        <span className="text-xs text-gray-300 italic">not detected</span>
                      ) : (
                        <span className={`text-xs font-mono ${key === "isImported" ? "text-indigo-700" : "text-gray-800"}`}>
                          {key === "isImported" ? (val ? "Yes" : "No") : String(val)}
                        </span>
                      )}
                      {isEmpty && (
                        <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">
                          will be skipped
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Multi-label matching explanation */}
          {multiRow && (
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
              <strong>Multi-record matching:</strong> Each record will be matched to a label by
              the <code className="bg-blue-100 px-1 rounded">filename</code> column if present,
              otherwise by position (Record 1 → Label 1, Record 2 → Label 2, etc.).
            </div>
          )}

          {!multiRow && labelCount > 1 && (
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
              <strong>Single record → applied to all {labelCount} labels.</strong> To use different
              data per label, upload a file with one row per label.
            </div>
          )}
        </div>
      )}

      {/* Template download hints */}
      {!result && !parsing && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
          <p className="text-xs font-semibold text-gray-600 mb-2">Expected columns (any order, flexible naming):</p>
          <div className="flex flex-wrap gap-1.5">
            {["Brand Name", "Class/Type", "Alcohol Content", "Net Contents", "Bottler Name", "City", "State", "Imported", "Country of Origin", "Filename (optional)"].map((col) => (
              <span key={col} className="px-2 py-0.5 rounded bg-white border border-gray-300 text-xs text-gray-600 font-mono">
                {col}
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Column names are matched flexibly — "brand", "Brand Name", "brand_name" all work.
            For batch uploads, include a "Filename" column to match records to specific label images.
          </p>
        </div>
      )}
    </div>
  );
}
