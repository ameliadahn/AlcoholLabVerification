/**
 * OCR Service using Tesseract.js
 * Runs in the browser via Web Workers for non-blocking processing.
 */

import Tesseract from "tesseract.js";

export interface OcrResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

export async function runOcr(
  imageSource: string | File | Blob,
  onProgress?: (progress: number) => void
): Promise<OcrResult> {
  const result = await Tesseract.recognize(imageSource, "eng", {
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  const { data } = result;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const words = ((data as any).words || []).map((w: any) => ({
    text: w.text,
    confidence: w.confidence,
    bbox: w.bbox,
  }));

  return {
    text: data.text,
    confidence: data.confidence,
    words,
  };
}
