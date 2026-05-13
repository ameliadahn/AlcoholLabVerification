/**
 * AI Label Analyzer — GPT-4o Vision
 *
 * Sends all label panels (front, back, neck, cap, etc.) to GPT-4o in a single
 * call and receives back all extracted TTB-required fields in structured JSON.
 * Analyzing all panels together allows the model to find required elements
 * that may be distributed across multiple surfaces (e.g. government warning
 * on back, brand name on front, bottler statement on side).
 *
 * This runs server-side only (called from the /api/analyze route) so the
 * OPENAI_API_KEY is never exposed to the browser.
 */

import OpenAI from "openai";
import { ApplicationData } from "./types";

const SYSTEM_PROMPT = `You are a TTB (Alcohol and Tobacco Tax and Trade Bureau) label compliance reviewer. Your authority comes from the Federal Alcohol Administration (FAA) Act (27 U.S.C. §§201–214) and TTB labeling regulations (27 CFR Parts 4, 5, and 7).

You will be given one or more images of an alcohol beverage label — each image represents a different panel of the same product (e.g. front label, back label, neck label, cap). Your job is to extract all text across ALL panels and identify all mandatory and prohibited content per TTB rules. You must return a precise JSON object — no markdown, no explanation, just raw JSON.

When multiple panels are provided, treat them as a single submission: a required element present on ANY panel satisfies the requirement.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANDATORY ELEMENTS (by product type)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALL products (beer, wine, spirits):
- Brand name (prominent and legible)
- Class/type designation (e.g. "Ale," "Wine," "Bourbon Whiskey," "Vodka")
- Net contents in metric units (mL or L) — imperial-only is non-compliant
- Alcohol content as % Alc. by Vol.
- Name and address of bottler, importer, or brewer
- Surgeon General health warning per 27 CFR 16.21 — must begin with "GOVERNMENT WARNING:" in all capitals

Beer / Malt Beverages (27 CFR Part 7):
- Mandatory additive statements (dyes, etc.)
- Country of origin if imported ("Product of [Country]" per CBP)

Wine (27 CFR Part 4):
- Appellation, vintage, and varietal information when claimed
- Foreign wine percentage if any foreign wine is used
- Country of origin if imported

Distilled Spirits (27 CFR Part 5):
- Country of origin if imported

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROHIBITED AND RESTRICTED CLAIMS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Flag any of the following as potential violations:

- HEALTH/THERAPEUTIC: Any claim implying health benefits, medical effects, or therapeutic value (e.g. "Heart Healthy," "Stress Reliever," "Cures sleeplessness," "nutritious," "Hangover-Free"). TTB Notice 884 (2012) bars all unqualified health or therapeutic claims.
- MISLEADING NUTRIENT: Nutrient-content claims (e.g. "low carb," "low sugar," "no fat," "light") without the required "statement of average analysis" or "Serving Facts" disclosure per TTB Ruling 2004–1.
- FALSE GEOGRAPHIC/PRODUCTION: Claims implying an origin or production method that is not met — e.g. calling a US-made product "Belgian Ale" without qualification, using "Champagne" for non-Champagne wine, or "Kentucky Bourbon" for a non-Kentucky product.
- UNVERIFIABLE/MISLEADING QUALITY: Unsubstantiated superlatives or subjective claims that cannot be objectively proven (e.g. "Best Whiskey in the World," "Premium Quality Guaranteed," "Award Winning" without a named award).
- EXCESSIVE DRINKING: Language promoting dangerous consumption or intoxication (e.g. "Drink All Night," "Gets You Wasted Fast," "Party Fuel").
- ORGANIC WITHOUT CERTIFICATION: Use of "organic" without valid USDA/AMS certification.
- OBSCENE/OFFENSIVE: Explicit sexual content, offensive language, or references to illegal activity.

Allowed claims (do NOT flag these):
- Truthful nutrient statements (calories, carbs, etc.) IF accompanied by full average analysis or Serving Facts
- "Light" or "lite" if not replacing the required class/type and accompanied by average analysis
- Specific truthful comparisons (e.g. "20 calories less than leading beer") based on equal volumes
- "Gluten-free" if product meets FDA's ≤20 ppm standard (27 CFR per TTB Ruling 2014–2 / 2020–2)
- Fanciful/distinctive product names (e.g. "Sandy Beaches") as long as they do not mislead about origin or contents
- "No GMO," "natural," or "vegan" if truthful and not implying a health benefit

━━━━━━━━━━━━━━━━━━━━━━━━━━
EXTRACTION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Extract text EXACTLY as it appears — preserve capitalization, punctuation, abbreviations, and spacing. Do NOT normalize, infer, complete, or reformat anything.
2. If text uses a non-standard format (e.g. "40 ABV" instead of "40% Alc. by Vol."), extract it verbatim. Compliance evaluation is handled downstream.
3. Return null for a field if the text is absent across ALL panels OR if you cannot clearly read every character. Do NOT guess or infer from blurry pixels — null is always correct when uncertain.
4. CONFIDENCE SCORING — score based on actual pixel-level readability across all panels, not your knowledge of what labels typically say:
   - 90–100: Every character is crisp, high-contrast, and unambiguous
   - 75–89: Most text is clear; minor legibility issues in small or peripheral text only
   - 50–74: Significant portions are blurry, low-contrast, or partially obscured
   - Below 50: Image is substantially degraded; most small text is unreadable
   A high confidence score on poor-quality images is a critical error.

━━━━━━━━━━━━━━━━━━━━━━━━━━
FIELD-SPECIFIC GUIDANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━

- brandName: Extract exactly as printed. Must be prominent and legible per TTB rules (≥2 mm on containers >½ pt).
- classType: Extract the FULL designation including all descriptive modifiers (e.g. "STRAIGHT BOURBON WHISKEY," "DISTILLED LONDON DRY GIN," "India Pale Ale"). "IPA" alone is insufficient — it must be qualified or treated as a fanciful name.
- alcoholContent: Extract verbatim even if non-standard (e.g. "40 ABV" or "40%"). TTB standard requires "X% Alc. by Vol." or "X% Alcohol by Volume."
- netContents: Extract verbatim including or excluding the unit as printed. TTB requires metric (mL or L); imperial-only is non-compliant.
- bottlerStatement: Extract the full statement including the qualifying verb ("Bottled by," "Distilled by," "Produced by," "Imported by," "Brewed by," "Packaged by"), company name, city, and state/country.
- governmentWarning: Populate ONLY if the label visibly shows "GOVERNMENT WARNING:" in all capitals (27 CFR 16.21). Return null if that exact header is absent across all panels.
- countryOfOrigin: For imported products only. TTB/CBP standard is "Product of [Country]." Return null if not present on any panel.`;

const buildUserPrompt = (appData: ApplicationData | null, panelCount: number) => `
Analyze ${panelCount === 1 ? "this alcohol beverage label image" : `these ${panelCount} alcohol beverage label panel images`} and extract all mandatory TTB label information per the FAA Act and 27 CFR Parts 4, 5, and 7.

${panelCount > 1 ? `The images show different panels of the same product label (e.g. front, back, neck, cap). Treat them as a single submission — a required field present on ANY panel satisfies the requirement.\n` : ""}
${appData ? `
Application data on file for comparison:
- Brand Name: ${appData.brandName || "(not provided)"}
- Class/Type: ${appData.classType || "(not provided)"}
- Alcohol Content: ${appData.alcoholContent || "(not provided)"}
- Net Contents: ${appData.netContents || "(not provided)"}
- Bottler/Importer: ${appData.bottlerName ?? "(not provided)"}, ${appData.bottlerCity || ""}, ${appData.bottlerState || ""}
- Is Imported: ${appData.isImported ? "Yes" : "No"}
- Country of Origin: ${appData.countryOfOrigin || "N/A"}

Compare each extracted field against the application data and flag any discrepancies in analysisNotes.
` : "No application data provided — perform format-only validation against TTB requirements."}

Return ONLY a valid JSON object with this exact structure:
{
  "rawText": "<all visible text across all panels, verbatim, in reading order — separate panels with '--- [Panel N] ---'>",
  "confidence": <integer 0–100 based on pixel-level image readability across all panels>,
  "extractedFields": {
    "brandName": "<brand name exactly as printed, or null>",
    "classType": "<full class/type designation exactly as printed including all modifiers, or null>",
    "alcoholContent": "<alcohol content statement exactly as printed (e.g. '40% Alc. by Vol.' or '40 ABV'), or null>",
    "netContents": "<net contents exactly as printed (e.g. '750 mL' or '750'), or null>",
    "bottlerStatement": "<full bottler/importer/brewer statement exactly as printed including qualifying verb and city/state, or null>",
    "governmentWarning": "<full warning text verbatim ONLY if 'GOVERNMENT WARNING:' header appears in all capitals; null otherwise>",
    "countryOfOrigin": "<country of origin exactly as printed for imported products (e.g. 'PRODUCT OF ENGLAND'), or null>",
    "prohibitedClaims": "<pipe-separated list of detected violations in format '[CATEGORY]: \\"exact claim text\\" — reason'; null if none detected>"
  },
  "analysisNotes": "<note image quality issues, partially obscured text, non-standard formats, which panel each key element was found on, and any discrepancies with application data; do NOT report prohibited claims here>"
}

Do not infer, complete, or reformat any text. Return null when text is absent or unreadable.`;

export interface AiAnalysisResult {
  rawText: string;
  confidence: number;
  extractedFields: {
    brandName: string | null;
    classType: string | null;
    alcoholContent: string | null;
    netContents: string | null;
    bottlerStatement: string | null;
    governmentWarning: string | null;
    countryOfOrigin: string | null;
    /** Pipe-separated list of prohibited/potentially prohibited claims detected, or null if none */
    prohibitedClaims: string | null;
  };
  analysisNotes: string;
}

export interface PanelImage {
  base64: string;
  mimeType: string;
}

// ── Application Document Extractor ───────────────────────────────────────────

const APP_DOC_SYSTEM_PROMPT = `You are a TTB (Alcohol and Tobacco Tax and Trade Bureau) compliance specialist. You will be given an image or scanned PDF of a TTB Certificate of Label Approval (COLA) application, a label application form, or any document that contains the filed application data for an alcohol beverage product.

Your job is to extract the structured application data fields and return them as a single JSON object. Return ONLY valid JSON — no markdown, no explanation.

Extraction rules:
1. Extract values exactly as they appear in the document. Do NOT normalize, infer, or reformat.
2. Return null for any field you cannot locate or clearly read.
3. For isImported, return true if the document indicates the product is imported (e.g. "Imported by", "Product of [foreign country]", or an import permit number is present), false otherwise.
4. bottlerState must be a US state abbreviation (e.g. "KY", "FL"). Extract from the bottler/importer address.
5. Confidence (0–100) reflects how clearly the document text is readable — not your certainty about the content.`;

const APP_DOC_USER_PROMPT = `Extract the TTB application data from this document and return ONLY this JSON structure:

{
  "brandName": "<brand name as filed, or null>",
  "classType": "<full class/type designation as filed (e.g. 'Kentucky Straight Bourbon Whiskey'), or null>",
  "alcoholContent": "<alcohol content as filed (e.g. '45% Alc./Vol.' or '45% Alc./Vol. (90 Proof)'), or null>",
  "netContents": "<net contents as filed (e.g. '750 mL'), or null>",
  "bottlerName": "<bottler or importer company name as filed, or null>",
  "bottlerCity": "<city from bottler/importer address, or null>",
  "bottlerState": "<US state abbreviation from bottler/importer address (e.g. 'KY'), or null>",
  "isImported": <true if this is an imported product, false otherwise>,
  "countryOfOrigin": "<country of origin as stated (e.g. 'Italy'), or null if not imported>",
  "confidence": <integer 0–100 reflecting document readability>,
  "notes": "<brief notes on readability issues, ambiguous fields, or anything the reviewer should double-check>"
}

Do not infer or guess values. Return null for any field that is absent or unreadable.`;

export interface AppDocExtractionResult {
  applicationData: ApplicationData;
  confidence: number;
  notes: string;
}

export async function analyzeApplicationDocument(
  doc: PanelImage
): Promise<AppDocExtractionResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 800,
    messages: [
      { role: "system", content: APP_DOC_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:${doc.mimeType};base64,${doc.base64}`,
              detail: "auto",
            },
          },
          { type: "text", text: APP_DOC_USER_PROMPT },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty response.");

  const parsed = JSON.parse(content);

  return {
    applicationData: {
      brandName: parsed.brandName ?? "",
      classType: parsed.classType ?? "",
      alcoholContent: parsed.alcoholContent ?? "",
      netContents: parsed.netContents ?? "",
      bottlerName: parsed.bottlerName ?? "",
      bottlerCity: parsed.bottlerCity ?? "",
      bottlerState: parsed.bottlerState ?? "",
      isImported: parsed.isImported === true,
      countryOfOrigin: parsed.countryOfOrigin ?? "",
    },
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 70,
    notes: parsed.notes ?? "",
  };
}

// ── Label Analyzer ────────────────────────────────────────────────────────────

export async function analyzeLabel(
  panels: PanelImage[],
  appData: ApplicationData | null
): Promise<AiAnalysisResult> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Build the image content blocks — one per panel
  const imageBlocks = panels.map((panel) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:${panel.mimeType};base64,${panel.base64}`,
      detail: "auto" as const,
    },
  }));

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1500,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: buildUserPrompt(appData, panels.length),
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response.");
  }

  const parsed = JSON.parse(content) as AiAnalysisResult;

  return {
    rawText: parsed.rawText ?? "",
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 75,
    extractedFields: {
      brandName: parsed.extractedFields?.brandName ?? null,
      classType: parsed.extractedFields?.classType ?? null,
      alcoholContent: parsed.extractedFields?.alcoholContent ?? null,
      netContents: parsed.extractedFields?.netContents ?? null,
      bottlerStatement: parsed.extractedFields?.bottlerStatement ?? null,
      governmentWarning: parsed.extractedFields?.governmentWarning ?? null,
      countryOfOrigin: parsed.extractedFields?.countryOfOrigin ?? null,
      prohibitedClaims: parsed.extractedFields?.prohibitedClaims ?? null,
    },
    analysisNotes: parsed.analysisNotes ?? "",
  };
}
