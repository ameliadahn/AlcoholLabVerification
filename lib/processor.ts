/**
 * Label Submission Processing Orchestrator
 *
 * Accepts ALL panels of a single label submission (front, back, neck, cap, etc.)
 * and processes them together as one unit.
 *
 * All field extraction uses Claude Haiku Vision exclusively via /api/analyze.
 * If the server returns an error the call throws — there is no OCR fallback
 * for field extraction.
 *
 * Government warning verification is the one intentional exception: Tesseract OCR
 * runs on all panels in parallel with the Claude API call so its time is completely
 * hidden behind the network round-trip. When Claude returns with the panel hint,
 * the OCR results are already ready and only the identified panel's result is used.
 */

import { v4 as uuidv4 } from "uuid";
import { runOcr, OcrResult } from "./ocr";
import { ParsedFields, extractGovernmentWarning } from "./field-parser";
import { validateGovernmentWarning, validateFieldOfVision, computeOverallStatus, computeOverallConfidence } from "./validation";
import { LabelValidationResult, ApplicationData, PanelUpload } from "./types";

// Claude handles images natively — keeping the longest side ≤ 768 balances
// readability of fine-print text against token cost and request latency.
// At 768px, each panel is ~800 image tokens vs ~1,400 at 1024px (~44% cheaper).
// Tesseract OCR handles the fine-print government warning independently, so
// Claude only needs to locate which panel it's on, not read every character.
/** Images smaller than this are upscaled so fine print is readable */
const MIN_IMAGE_DIMENSION = 512;
/** Images larger than this are downscaled to reduce image tokens and latency */
const MAX_IMAGE_DIMENSION = 768;
/** Higher quality preserves small-text detail that JPEG artifacts would destroy */
const JPEG_QUALITY = 0.92;

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
      const maxDim = Math.max(w, h);
      // Upscale images that are too small so fine-print text (ABV, net contents,
      // bottler address) occupies enough pixels for Claude to read reliably.
      // Downscale images that are too large to keep payload size manageable.
      const scale = maxDim < MIN_IMAGE_DIMENSION
        ? MIN_IMAGE_DIMENSION / maxDim
        : Math.min(1, MAX_IMAGE_DIMENSION / maxDim);
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
 * Scores the OCR-extracted government warning text against per-panel word-level
 * Tesseract confidence scores. Returns 20 (null required field) when no warning
 * was found, otherwise the best single-panel word-match score, falling back to
 * the document average when no panel has enough matching tokens.
 */
function scoreOcrWarningConfidence(
  warningText: string | null,
  ocrResults: OcrResult[]
): number {
  if (!warningText) return 20;

  const avgConf = Math.round(
    ocrResults.reduce((s, r) => s + r.confidence, 0) / ocrResults.length
  );

  const tokens = warningText
    .toLowerCase()
    .split(/[\s.,;:()!?]+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length > 2);

  if (tokens.length === 0) return avgConf;

  let bestScore = -1;
  for (const ocr of ocrResults) {
    const map = new Map<string, number>();
    for (const w of ocr.words) {
      const key = w.text.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (key.length > 1 && !map.has(key)) map.set(key, w.confidence);
    }
    const hits = tokens
      .map((t) => map.get(t))
      .filter((c): c is number => c !== undefined);
    if (hits.length >= Math.ceil(tokens.length / 2)) {
      const score = Math.round(hits.reduce((s, c) => s + c, 0) / hits.length);
      if (score > bestScore) bestScore = score;
    }
  }

  const raw = bestScore >= 0 ? bestScore : avgConf;
  return Math.min(100, raw + 10);
}

/**
 * Process a complete label submission: all panels analyzed together via Claude Haiku Vision.
 *
 * @param panels                - Array of PanelUpload objects (each has file + previewUrl)
 * @param onProgress            - Unused; kept for interface compatibility
 * @param manualApplicationData - When provided (manual entry mode), skips the registry lookup
 *                                and uses this data for field comparisons instead
 * @param signal                - Optional AbortSignal; aborts the in-flight fetch
 */
export async function processSubmission(
  panels: PanelUpload[],
  onProgress?: (progress: number) => void,
  manualApplicationData?: ApplicationData,
  signal?: AbortSignal
): Promise<LabelValidationResult> {
  void onProgress; // government warning OCR has no meaningful progress to report

  const startTime = Date.now();
  const fileNames = panels.map((p) => p.file.name);
  const imageUrls = panels.map((p) => p.previewUrl);

  // Encode all panels (upscale small images, convert to JPEG)
  const encoded = await Promise.all(panels.map((p) => fileToBase64(p.file)));
  signal?.throwIfAborted();

  const panelPayloads = encoded.map((enc, i) => ({
    base64: enc.base64,
    mimeType: enc.mimeType,
    fileName: fileNames[i],
  }));

  // Kick off Tesseract OCR on ALL panels immediately — runs in parallel with the
  // Claude API call so its processing time is completely hidden behind the network
  // round-trip. By the time Claude returns with the panel hint, the OCR results
  // are already done (or nearly done). This removes 3–8 s from perceived latency.
  const allOcrPromise = Promise.all(panels.map((p) => runOcr(p.file)));

  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ panels: panelPayloads, manualApplicationData }),
    signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body.error ?? `Claude analysis request failed (HTTP ${response.status})`;
    const err = new Error(message);
    // Tag rate-limit errors so callers can show a different message.
    if (response.status === 429) (err as Error & { isRateLimit: boolean }).isRateLimit = true;
    throw err;
  }

  const data = await response.json().catch(() => {
    throw new Error("Server returned an unexpected response. Please try again.");
  });

  // Claude identified which panel holds the government warning.
  // All other fields are extracted exclusively by Claude — never by OCR.
  const panelHint: number | null = data.governmentWarningPanelHint ?? null;
  const panelIndex =
    panelHint !== null && panelHint >= 1 && panelHint <= panels.length
      ? panelHint - 1
      : null;

  let govWarnResult = data.fields?.governmentWarning;
  let newFieldOfVision = data.fieldOfVision;
  let newOverallStatus = data.overallStatus;
  let newOcrConfidence = data.ocrConfidence;

  // The AI may have successfully read the government warning text directly from the image.
  // The server ran validation against the AI text; the extractedValue on the result holds
  // the raw string that was extracted (or null if the AI returned null).
  const aiWarningText: string | null = data.fields?.governmentWarning?.extractedValue ?? null;
  // governmentWarningLegible is forwarded from the AI's self-attestation via analysisNotes
  // or from the field result status — a non-null extractedValue with a non-fail status
  // means the AI successfully read it.
  const aiWarningLegible: boolean =
    aiWarningText !== null && data.fields?.governmentWarning?.status !== "fail";

  try {
    // OCR was already running in parallel — await the settled results now.
    // If OCR finished before Claude, this resolves instantly with no extra wait.
    const allOcrResults = await allOcrPromise;

    let warningText: string | null = null;
    let warningLegible: boolean | undefined = undefined;
    let warningConf = 20;

    if (aiWarningLegible && aiWarningText) {
      // Anti-hallucination check: verify OCR can find at least one distinctive
      // anchor word from the government warning text across ALL panels.
      // We check all panels (not just the identified one) because:
      //   a) Claude's panel ID can be off by one
      //   b) Tesseract may fail on one panel's font/size but succeed on another
      // A label with no government warning at all will have none of these words
      // anywhere — that's the hallucination signal we're catching.
      // "pregnancy" and "impairs" are the most distinctive; "surgeon" and "birth"
      // provide additional coverage for labels where one word is OCR-garbled.
      const anchorWords = ["surgeon", "impairs", "birth", "pregnancy"];
      const allPanelsOcrText = allOcrResults.map((r) => r.text).join(" ").toLowerCase();
      const ocrConfirmsWarning = anchorWords.some((w) => allPanelsOcrText.includes(w));

      if (ocrConfirmsWarning) {
        // OCR independently found warning anchor words — AI extraction is trustworthy.
        // Use AI text with the strict 95% threshold.
        warningText = aiWarningText;
        warningLegible = true;
        warningConf = scoreOcrWarningConfidence(warningText, allOcrResults);
      } else {
        // OCR found none of the government warning anchor words on any panel.
        // Rather than nulling out (which causes false "missing" failures when
        // Tesseract simply can't read fine print that Claude could), keep the AI
        // text but treat it as unattested — apply the more lenient OCR threshold
        // (85%) instead of the AI threshold (95%). This still rejects hallucinated
        // text that is a near-perfect copy of the standard wording, while allowing
        // genuine readings with minor variations to pass.
        warningText = aiWarningText;
        warningLegible = undefined;
        warningConf = scoreOcrWarningConfidence(warningText, allOcrResults);
      }
    } else {
      // AI couldn't read it (fine print too small) — fall back to Tesseract OCR.
      let ocrWarningText: string | null = null;
      if (panelIndex !== null) {
        const ocrResult = allOcrResults[panelIndex];
        ocrWarningText = extractGovernmentWarning(ocrResult.text);
        warningConf = scoreOcrWarningConfidence(ocrWarningText, [ocrResult]);
      } else {
        const combinedText = allOcrResults
          .map((r, i) => `--- [Panel ${i + 1}] ---\n${r.text}`)
          .join("\n\n");
        ocrWarningText = extractGovernmentWarning(combinedText);
        warningConf = scoreOcrWarningConfidence(ocrWarningText, allOcrResults);
      }
      warningText = ocrWarningText;
      warningLegible = undefined; // OCR path — no legibility attestation
    }

    const warningParsedFields: ParsedFields = {
      brandName: null, classType: null, alcoholContent: null,
      netContents: null, bottlerStatement: null,
      governmentWarning: warningText,
      governmentWarningLegible: warningLegible,
      countryOfOrigin: null, rawText: "", prohibitedClaims: null,
    };
    govWarnResult = validateGovernmentWarning(warningParsedFields, warningConf);

    const fovParsedFields: ParsedFields = {
      brandName: data.fields?.brandName?.extractedValue ?? null,
      classType: data.fields?.classType?.extractedValue ?? null,
      alcoholContent: data.fields?.alcoholContent?.extractedValue ?? null,
      netContents: null,
      bottlerStatement: null,
      governmentWarning: warningText,
      governmentWarningLegible: warningLegible,
      countryOfOrigin: null,
      rawText: data.ocrText ?? "",
      prohibitedClaims: null,
    };
    const fovConf: number = data.fieldOfVision?.confidence ?? data.ocrConfidence ?? 80;
    newFieldOfVision = validateFieldOfVision(fovParsedFields, fovConf);

    const patchedResults = {
      ...data.fields,
      governmentWarning: govWarnResult,
      fieldOfVision: newFieldOfVision,
    };
    newOverallStatus = computeOverallStatus(patchedResults);
    newOcrConfidence = computeOverallConfidence(patchedResults);
  } catch {
    // Government warning OCR failed — keep the server-computed warning result
  }

  return {
    ...data,
    imageUrls,
    id: data.id ?? uuidv4(),
    fields: { ...data.fields, governmentWarning: govWarnResult },
    fieldOfVision: newFieldOfVision,
    overallStatus: newOverallStatus,
    ocrConfidence: newOcrConfidence,
  } as LabelValidationResult;
}
