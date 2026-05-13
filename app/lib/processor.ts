/**
 * Label Submission Processing Orchestrator
 *
 * Accepts ALL panels of a single label submission (front, back, neck, cap, etc.)
 * and processes them together as one unit.
 *
 * Primary path:   all panels → /api/analyze (server-side GPT-4o Vision) → single validation result
 * Fallback path:  all panels → Tesseract OCR (client-side, per panel, text concatenated)
 *                           → field parsing → validation result
 *
 * The fallback activates automatically when the API key is not configured
 * or when the OpenAI request fails.
 */

import { v4 as uuidv4 } from "uuid";
import { runOcr } from "./ocr";
import { parseFields } from "./field-parser";
import { validateLabel, computeOverallStatus } from "./validation";
import { LabelValidationResult, ApplicationData, PanelUpload } from "./types";

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

const MAX_IMAGE_DIMENSION = 1024;
const JPEG_QUALITY = 0.85;

async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  if (file.type === "application/pdf") {
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

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const { naturalWidth: w, naturalHeight: h } = img;
      const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(w, h));
      const targetW = Math.round(w * scale);
      const targetH = Math.round(h * scale);

      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.getContext("2d")!.drawImage(img, 0, 0, targetW, targetH);

      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      const [meta, base64] = dataUrl.split(",");
      const mimeType = meta.replace("data:", "").replace(";base64", "");
      resolve({ base64, mimeType });
    };

    img.onerror = reject;
    img.src = objectUrl;
  });
}

/**
 * Process a complete label submission: all panels analyzed together.
 *
 * @param panels                - Array of PanelUpload objects (each has file + previewUrl)
 * @param onProgress            - Optional progress callback (0–100), called during OCR fallback
 * @param manualApplicationData - When provided (manual entry mode), skips the registry lookup
 *                                and uses this data for field comparisons instead
 * @param signal                - Optional AbortSignal; aborts the fetch and OCR work in progress
 */
export async function processSubmission(
  panels: PanelUpload[],
  onProgress?: (progress: number) => void,
  manualApplicationData?: ApplicationData,
  signal?: AbortSignal
): Promise<LabelValidationResult> {
  const startTime = Date.now();
  const fileNames = panels.map((p) => p.file.name);
  const imageUrls = panels.map((p) => p.previewUrl);

  // ── Primary path: GPT-4o via server-side API route ──────────────────────
  try {
    const encoded = await Promise.all(panels.map((p) => fileToBase64(p.file)));

    signal?.throwIfAborted();

    const panelPayloads = encoded.map((enc, i) => ({
      base64: enc.base64,
      mimeType: enc.mimeType,
      fileName: fileNames[i],
    }));

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ panels: panelPayloads, manualApplicationData }),
      signal,
    });

    if (response.ok) {
      const data = await response.json();

      if (!data.fallbackToOcr) {
        return {
          ...data,
          imageUrls,
          id: data.id ?? uuidv4(),
        } as LabelValidationResult;
      }

      // Server says to fall through to client-side OCR
      const matchedApplicationData = data.matchedApplicationData ?? null;
      const matchedApplicationId = data.matchedApplicationId ?? null;
      const unmatched = data.unmatched ?? true;

      return await runOcrFallback(
        panels,
        fileNames,
        imageUrls,
        matchedApplicationData,
        matchedApplicationId,
        unmatched,
        startTime,
        onProgress,
        signal
      );
    }
  } catch (err) {
    // Re-throw abort errors so the caller can handle them cleanly
    if (err instanceof Error && err.name === "AbortError") throw err;
    console.warn("API route unavailable, falling back to Tesseract:", err);
  }

  signal?.throwIfAborted();

  // ── Full client-side OCR fallback (network error) ────────────────────────
  // If manual data was supplied, preserve it so field comparisons still work.
  return await runOcrFallback(
    panels,
    fileNames,
    imageUrls,
    manualApplicationData ?? null,
    manualApplicationData ? "manual" : null,
    !manualApplicationData,
    startTime,
    onProgress,
    signal
  );
}

async function runOcrFallback(
  panels: PanelUpload[],
  fileNames: string[],
  imageUrls: string[],
  matchedApplicationData: ApplicationData | null,
  matchedApplicationId: string | null,
  unmatched: boolean,
  startTime: number,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
): Promise<LabelValidationResult> {
  const appData = matchedApplicationData ?? EMPTY_APP_DATA;

  // Run OCR on every panel sequentially so we can check for abort between panels.
  const ocrResults = [];
  for (let i = 0; i < panels.length; i++) {
    signal?.throwIfAborted();
    const result = await runOcr(
      panels[i].file,
      onProgress ? (p) => onProgress(Math.round((i + p / 100) / panels.length * 100)) : undefined
    );
    ocrResults.push(result);
  }

  const combinedText = ocrResults
    .map((r, i) => `--- [Panel ${i + 1}: ${fileNames[i]}] ---\n${r.text}`)
    .join("\n\n");

  const avgConfidence =
    ocrResults.reduce((sum, r) => sum + r.confidence, 0) / ocrResults.length;

  const parsedFields = parseFields(combinedText);
  const validationResults = validateLabel(parsedFields, appData, avgConfidence);
  const overallStatus = computeOverallStatus(validationResults);

  return {
    id: uuidv4(),
    fileNames,
    imageUrls,
    panelCount: panels.length,
    overallStatus,
    processedAt: new Date().toISOString(),
    processingTimeMs: Date.now() - startTime,
    ocrText: combinedText,
    ocrConfidence: avgConfidence,
    matchedApplicationId,
    matchedApplicationData,
    unmatched,
    fields: validationResults,
    fieldOfVision: validationResults.fieldOfVision,
    usedAi: false,
  };
}
