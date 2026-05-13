/**
 * POST /api/analyze
 *
 * Server-side route that:
 * 1. Receives all label panel images (base64) and their filenames for one submission
 * 2. Looks up the matching application record from the JSON registry
 *    (panel position suffixes like _front, _back, _neck are stripped automatically)
 * 3. Calls GPT-4o Vision with ALL panels in a single request so it can
 *    synthesize required elements distributed across multiple label surfaces
 * 4. Falls back to Tesseract OCR (client-side) if OpenAI is unavailable
 * 5. Runs the TTB compliance validation engine
 * 6. Returns a complete LabelValidationResult covering the whole submission
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { analyzeLabel, PanelImage } from "@/lib/ai-analyzer";
import { validateLabel, computeOverallStatus } from "@/lib/validation";
import { lookupByPanelFilenames } from "@/lib/application-registry";
import { LabelValidationResult, ApplicationData } from "@/lib/types";

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

interface PanelPayload {
  base64: string;
  mimeType: string;
  fileName: string;
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  let body: { panels: PanelPayload[]; manualApplicationData?: ApplicationData };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { panels, manualApplicationData } = body;
  if (!Array.isArray(panels) || panels.length === 0) {
    return NextResponse.json(
      { error: "panels must be a non-empty array of { base64, mimeType, fileName }." },
      { status: 400 }
    );
  }

  const fileNames = panels.map((p) => p.fileName);

  // Step 1: Resolve application data — prefer manually supplied data over registry lookup.
  const lookup = manualApplicationData
    ? {
        record: null,
        applicationData: manualApplicationData,
        matchedId: "manual" as string | null,
        unmatched: false,
      }
    : lookupByPanelFilenames(fileNames);

  const appData: ApplicationData = lookup.applicationData ?? EMPTY_APP_DATA;

  // Step 2: Try GPT-4o Vision first
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "your-openai-api-key-here") {
    try {
      const panelImages: PanelImage[] = panels.map((p) => ({
        base64: p.base64,
        mimeType: p.mimeType || "image/jpeg",
      }));

      const aiResult = await analyzeLabel(panelImages, lookup.applicationData ?? null);

      const validationResults = validateLabel(
        {
          brandName: aiResult.extractedFields.brandName,
          classType: aiResult.extractedFields.classType,
          alcoholContent: aiResult.extractedFields.alcoholContent,
          netContents: aiResult.extractedFields.netContents,
          bottlerStatement: aiResult.extractedFields.bottlerStatement,
          governmentWarning: aiResult.extractedFields.governmentWarning,
          countryOfOrigin: aiResult.extractedFields.countryOfOrigin,
          prohibitedClaims: aiResult.extractedFields.prohibitedClaims,
          rawText: aiResult.rawText,
        },
        appData,
        aiResult.confidence
      );

      const overallStatus = computeOverallStatus(validationResults);

      const result: LabelValidationResult & { usedAi: boolean; analysisNotes: string } = {
        id: uuidv4(),
        fileNames,
        imageUrls: [],   // filled in client-side from blob URLs
        panelCount: panels.length,
        overallStatus,
        processedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
        ocrText: aiResult.rawText,
        ocrConfidence: aiResult.confidence,
        matchedApplicationId: lookup.record?.id ?? lookup.matchedId ?? null,
        matchedApplicationData: lookup.applicationData ?? null,
        unmatched: lookup.unmatched,
        fields: validationResults,
        fieldOfVision: validationResults.fieldOfVision,
        usedAi: true,
        analysisNotes: aiResult.analysisNotes,
      };

      return NextResponse.json(result);
    } catch (aiError) {
      console.error("OpenAI analysis failed, falling back to Tesseract:", aiError);
    }
  }

  // Step 3: Tesseract fallback — handled client-side
  return NextResponse.json({
    fallbackToOcr: true,
    fileNames,
    matchedApplicationId: lookup.record?.id ?? lookup.matchedId ?? null,
    matchedApplicationData: lookup.applicationData ?? null,
    unmatched: lookup.unmatched,
    reason:
      !process.env.OPENAI_API_KEY ||
      process.env.OPENAI_API_KEY === "your-openai-api-key-here"
        ? "OPENAI_API_KEY not configured"
        : "OpenAI request failed",
  });
}
