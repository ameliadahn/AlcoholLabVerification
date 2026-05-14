/**
 * AI Label Analyzer — Claude Haiku Vision
 *
 * Sends all label panels (front, back, neck, cap, etc.) to Claude in a single
 * call and receives back all extracted TTB-required fields in structured JSON.
 * Analyzing all panels together allows the model to find required elements
 * that may be distributed across multiple surfaces (e.g. government warning
 * on back, brand name on front, bottler statement on side).
 *
 * This runs server-side only (called from the /api/analyze route) so the
 * ANTHROPIC_API_KEY is never exposed to the browser.
 */

import Anthropic from "@anthropic-ai/sdk";
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

SCANNING PROCEDURE — do this before filling in prohibitedClaims:
1. Read every text block on every panel in full — front label, back label, neck label, cap, and fine print. Do NOT only check prominent slogans. Most violations are buried in back-label copy, brand stories, and product descriptions.
2. For each sentence ask: Does it imply a health benefit? Does it promote irresponsible drinking? Does it make a factual-sounding claim that cannot be verified? Would a reasonable consumer be misled?
3. Finally, consider the OVERALL IMPRESSION. Even if no single statement is technically prohibited, a combination of elements (medical-style imagery + explicit wellness/fitness framing + "healthy" language) can collectively imply health benefits and must be flagged. Note: "pure," "purity," "clean," and "natural" are standard sensory/production descriptors — do NOT treat them as health language unless they are directly paired with medical imagery or explicit wellness claims.
4. When uncertain between flagging and ignoring — always flag at REVIEW. A false positive a human can clear is far less harmful than a missed violation.

━━━━━━━━━━━━━━━━━━━━━━━━━
FAIL SEVERITY — clear violations, no legitimate reading possible
━━━━━━━━━━━━━━━━━━━━━━━━━

[HEALTH/THERAPEUTIC|FAIL]
Any language that implies a health benefit, wellness improvement, medical effect, therapeutic value, or reduced health risk from consuming the product.
This includes: direct benefit claims, wellness framing, and dietary/medical language.
  ❌ "Heart Healthy" — implies cardiovascular benefit
  ❌ "Boosts Immunity" — implies immune system benefit
  ❌ "Good for Stress Relief" — implies therapeutic benefit
  ❌ "Hangover-Free" — implies reduced harm from alcohol
  ❌ "Healthy Choice Vodka" — directly frames alcohol as a health product
  ❌ "Perfect recovery drink" — implies therapeutic recovery value
  ❌ "Cleansing," "Detoxifying," "Restorative," "Revitalizing" — wellness/therapeutic framing
  ❌ "Vitamin-enriched," "Nutritious," "Enriched with antioxidants" — dietary health claims

[INTOXICATION/EXCESSIVE DRINKING|FAIL]
Any language that encourages, glamorizes, or promotes irresponsible drinking, dangerous overconsumption, or intoxication.
  ❌ "Drink More" / "Never Stop Pouring" / "Have Another" — direct consumption encouragement
  ❌ "Party All Night" / "Drink All Night" — promotes unsafe sustained consumption
  ❌ "Get Wasted Fast" / "Guaranteed Buzz" — promotes intoxication as the goal
  ❌ "Hits harder" / "Gets you there faster" / "More intense buzz" — promotes intoxication speed/intensity
  ❌ "Party Fuel" — frames the product as a tool for binge-drinking

[ORGANIC WITHOUT CERTIFICATION|FAIL]
"Organic" or "made with organic [ingredient]" anywhere on the label without a USDA/AMS certifying agent and certificate number visibly cited.

[FALSE GEOGRAPHIC/PRODUCTION|FAIL]
Claims implying a protected origin or production method the product does not meet.
  ❌ "Champagne" for a US sparkling wine
  ❌ "Kentucky Bourbon" for a non-Kentucky product
  ❌ "Belgian Ale" for a US-made beer
  ❌ "Cognac" for a non-Cognac brandy
  ❌ False aging statements ("Aged 12 Years" when not aged 12 years)

[OBSCENE/OFFENSIVE/ILLEGAL|FAIL]
Explicit sexual content, graphic violence, offensive slurs, discriminatory language, or references to illegal activity.

━━━━━━━━━━━━━━━━━━━━━━━━━
REVIEW SEVERITY — requires human verification
━━━━━━━━━━━━━━━━━━━━━━━━━

[MISLEADING QUALITY CLAIM|REVIEW]
Absolute superlatives or exaggerated quality claims that assert objective superiority without a verifiable source.
  ❌ "World's Smoothest Bourbon" — absolute quality superlative, unverifiable
  ❌ "Perfect Every Time" — absolute performance claim
  ✅ "Exceptionally smooth" / "Our finest blend" — subjective/relative, not an absolute assertion — do NOT flag

[UNVERIFIABLE AWARD/RECOGNITION|REVIEW]
Any award, medal, ranking, or accolade claim that does not name a specific identifiable competition/awarding body and year.
  ❌ "Gold Medal Winner" — no named competition or year
  ❌ "Award Winning Bourbon" — no named award, source, or year
  ❌ "Critically Acclaimed" / "Top Rated" — no named source
  ✅ "2023 San Francisco World Spirits Competition Double Gold" — specific, verifiable — do NOT flag

[MISLEADING HEALTH IMPLICATION|REVIEW]
Language that stops short of an explicit health claim but strongly implies a wellness, dietary, or lifestyle benefit.
  ❌ "Guilt-free" — implies the product is a healthier choice
  ❌ "The clean spirit" — implies health/purity benefit beyond flavor
  ❌ "Better for you" / "The healthy way to celebrate" — implies health benefit
  ❌ "Fits your active lifestyle" — implies compatibility with healthy living

[MISLEADING OVERALL IMPRESSION|REVIEW]
Even when no single statement is prohibited, the COMBINATION of elements on the label may collectively imply a health or wellness benefit and mislead a reasonable consumer.
  Flag when: medical-style imagery (e.g. green cross, pill/syringe graphics, doctor/clinical iconography) + explicit wellness or fitness framing (e.g. "Fit for the active lifestyle," "Better for your body," "The healthy way") appear together in a way that frames the product as a healthy choice.
  IMPORTANT — do NOT flag "pure," "purity," "clean," "natural," or "exceptional purity" on their own. These are standard sensory/production descriptors for spirits and do NOT constitute a health claim unless they are directly paired with medical-style imagery or an explicit wellness benefit statement.
  Example that SHOULD be flagged: A label with a green cross icon, "Pure. Clean. Natural." copy, and "Fit for the active lifestyle" — the combination implies health benefits.
  Example that should NOT be flagged: A label that says "Exceptional Purity" or "Pure. Clean." with no medical imagery and no wellness/fitness claims — this is standard sensory language.

[MISLEADING NUTRIENT|REVIEW]
Nutrient-content claims without the required "statement of average analysis" or "Serving Facts" panel (TTB Ruling 2004–1).
  ❌ "Only 80 Calories" (no average analysis present)
  ❌ "Low Carb," "Low Sugar," "No Fat" (no analysis panel)
  ✅ "80 Calories per serving" when accompanied by a full Serving Facts panel — do NOT flag

━━━━━━━━━━━━━━━━━━━━━━━━━
DO NOT FLAG — standard industry language
━━━━━━━━━━━━━━━━━━━━━━━━━
- Production process descriptors: "Small Batch," "Handcrafted," "Craft," "Artisan," "Pot Still," "Single Malt," "Barrel Aged," "Cask Strength," "Distilled X Times," "Aged X Years in [barrel type]," "Limited Edition," "Reserve," "Single Barrel"
- Sensory and flavor language: "smooth," "crisp," "clean finish," "rich," "complex," "bold," "robust," "velvety," "refined," "nuanced," "smooth finish," "lingering finish," "exceptional clarity," "exceptional purity," "pure," "purity" — these describe taste/texture and distillation quality, not health
- Subjective quality adjectives with no objective assertion: "premium," "superior," "fine," "exceptional," "ultra," "world-class" — these are standard puffery
- Truthful origin statements about the product's actual location: "Distilled in Kentucky" (for a Kentucky product), "Brewed in Colorado" (for a Colorado product)
- Fanciful/humorous brand names or taglines that make no objective claim: "Sandy Beaches Rum," "Your Mom's Favorite Vodka"
- Specific verifiable awards with a named source: "2023 SF World Spirits Competition Gold"
- "Gluten-free" (when product qualifies), "vegan," "kosher," "non-GMO" — factual certifications, not health claims

Format each detected violation as: [CATEGORY|SEVERITY]: "exact claim text as it appears on the label" — reason
Examples:
  [HEALTH/THERAPEUTIC|FAIL]: "Good for Stress Relief" — implies therapeutic benefit from consuming alcohol
  [INTOXICATION/EXCESSIVE DRINKING|FAIL]: "Party All Night" — promotes unsafe sustained consumption
  [MISLEADING QUALITY CLAIM|REVIEW]: "World's Smoothest Bourbon" — absolute quality superlative with no named verification source
  [UNVERIFIABLE AWARD/RECOGNITION|REVIEW]: "Gold Medal Winner" — award claim with no named competition or year
  [MISLEADING HEALTH IMPLICATION|REVIEW]: "The guilt-free spirit" — implies the product is a healthier choice

━━━━━━━━━━━━━━━━━━━━━━━━━━
EXTRACTION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Extract text EXACTLY as it appears — preserve capitalization, punctuation, abbreviations, and spacing. Do NOT normalize, infer, complete, or reformat anything.
2. If text uses a non-standard format (e.g. "40 ABV" instead of "40% Alc. by Vol."), extract it verbatim. Compliance evaluation is handled downstream.
3. Return null for a field if the text is absent across ALL panels OR if you cannot clearly read every character. Do NOT guess or infer from blurry pixels — null is always correct when uncertain.
4. CONFIDENCE SCORING — assign an independent score (0–100) to EACH field based on how clearly that specific text is readable on its best available panel. Output every score in the "fieldConfidences" JSON object. The top-level "confidence" is your general overall impression of label legibility. NEVER output the same number for every field in "fieldConfidences" unless the images genuinely make every field equally legible.

   CRITICAL RULE: A blurry supplementary panel (product photograph, staged shot, lifestyle image of the bottle) must NEVER lower the confidence for a field that is clearly readable on a dedicated flat label scan. Evaluate each panel independently and use the best source for each field.

   Panel reliability hierarchy (use the highest available for each field):
   a. FLAT LABEL SCANS — 2D label surfaces photographed face-on; text is rectilinear. Primary, authoritative source. Use their clarity when scoring.
   b. CLOSE-UP LABEL PHOTOS — high-resolution close-ups of a single label surface on a bottle or can. Treat as flat scans.
   c. PRODUCT PHOTOGRAPHS — the complete packaged product photographed in a real-world or staged setting. The label wraps around a curved surface and the image may have blur, perspective distortion, or depth-of-field effects. These are SUPPLEMENTARY CONTEXT ONLY. DO NOT use a product photograph to lower the confidence of a field that is already clearly extracted from a flat scan or close-up.

   IMPORTANT: Do not rely on the filename alone to determine a panel's type — always verify visually. A file named "frontLabel" may still be a product photograph if the image shows a bottle in a scene rather than a flat label surface. Classify each panel from its visual content.

   Confidence scale (applied independently per field):
   - 90–100: Every character crisp, high-contrast, and unambiguous on the best available panel. Expected for a professionally printed flat label scan.
   - 75–89: Field clearly legible on best panel; only minor issues (small print, minor glare).
   - 50–74: Field has genuine legibility problems even on its best available panel — blur, damage, or obstruction.
   - Below 50: Field is substantially unreadable across all submitted panels.

   CRITICAL — DO NOT UNDER-SCORE CLEAR LABELS: For a professionally printed flat label scan where text is sharp, well-lit, and every character is readable, the confidence MUST be 90 or above. Scores below 80 are only appropriate when there is a real legibility problem (blur, shadow, damage, very small text). Do not assign a low score as a precaution or out of caution when the label is clearly readable — that is a scoring error that causes good labels to be incorrectly flagged for review.

   A critical scoring error is returning a low overall confidence because a staged bottle photograph is blurry while a crisp flat label scan of the same label is also in the submission.

━━━━━━━━━━━━━━━━━━━━━━━━━━
FIELD-SPECIFIC GUIDANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL — NO METADATA IN FIELD VALUES: The panel separator markers you write into rawText (e.g. "--- [Panel 1] ---") are structural markers YOU generate — they are never printed on the physical label. NEVER copy any separator marker, filename, image number, or any structural metadata into any extractedFields value. If you find "---", "[Panel", "[Image", a filename (e.g. "label.png"), or "Image N" appearing in a field value you are about to return, STOP — that is a critical extraction error. Return null for that field instead. This rule has no exceptions.

- brandName: Extract ONLY text that is visibly printed on the physical label surface. NEVER return a panel separator marker, filename, or any metadata as the brand name. If you cannot find a clearly printed brand name, return null.
- classType: Extract the FULL designation including all descriptive modifiers (e.g. "STRAIGHT BOURBON WHISKEY," "DISTILLED LONDON DRY GIN," "India Pale Ale"). "IPA" alone is insufficient — it must be qualified or treated as a fanciful name.
- alcoholContent: Extract verbatim even if non-standard (e.g. "40 ABV" or "80 Proof"). When the statement includes a proof value in parentheses (e.g. "40% ALC./VOL. (80 Proof)"), extract the COMPLETE statement including the closing parenthesis — never truncate mid-expression at an open parenthesis.
- netContents: Extract verbatim including or excluding the unit as printed. TTB requires metric (mL or L); imperial-only is non-compliant.
- bottlerStatement: Extract ONLY the company name and address — do NOT include the qualifying phrase ("Bottled by", "Distilled by", "Imported by", "Canned by", etc.) in the value. The qualifying phrase tells you WHERE to look; the value must be just the name and location. Combine across line breaks if needed. Example: if the label shows "DISTILLED AND BOTTLED BY" on line 1, "GREENMEADOW DISTILLING CO." on line 2, and "PORTLAND, OREGON" on line 3, the correct extraction is "GREENMEADOW DISTILLING CO. PORTLAND, OREGON". Stopping at the company name without the city and state is a critical extraction error.
- governmentWarning: Always return null. The government warning text is extracted and verified independently by OCR — do not attempt to read, transcribe, or guess it.
- governmentWarningLegible: Always return false. The government warning is handled by OCR, not by this analysis.
- governmentWarningPanel: Look at all submitted panels and identify which one contains the "GOVERNMENT WARNING:" fine-print block (typically a dense paragraph of small text near the bottom of the back panel). Return the 1-indexed panel number (e.g. 1 for the first image, 2 for the second). Return null if you cannot locate the warning block on any panel.
- countryOfOrigin: For imported products only. TTB/CBP standard is "Product of [Country]." Return null if not present on any panel.

━━━━━━━━━━━━━━━━━━━━━━━━━━
EDGE CASES AND EXAMPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━

A. BLURRY OR GARBLED GOVERNMENT WARNING — return null, never reconstruct
The government warning must be read character-by-character from the image pixels. If the body text is blurry, low-contrast, too small to read clearly, garbled/jumbled, or requires guessing any word — return null regardless of how much of it you can partially make out. Do NOT fill in words you cannot clearly see even if you know the standard wording.
  ✗ Wrong: "governmentWarning": "GOVERNMENT WARNING: (1) According to the Surgeon General..." ← filled in from memory/training even though text was blurry or jumbled
  ✗ Wrong: Seeing garbled or jumbled characters in the warning area and returning the standard wording anyway because "it must be the government warning"
  ✓ Right: "governmentWarning": null, "governmentWarningLegible": false, analysisNotes: "Government warning present on Panel 2 but text is fine print — could not read every word from pixels with certainty."
  ✓ Right: "governmentWarning": null, "governmentWarningLegible": false, analysisNotes: "Warning area visible on Panel 1 but text appears as garbled/jumbled characters — not readable."
  ✓ Also right: Return the full text only when you have read every single word character-by-character from the pixels with zero doubt about any character, and confirmed in the self-check (Step 4) that you did not recall it from memory.

B. CROSS-PANEL ABV NUMBER CONFLICT — flag in analysisNotes
When multiple panels show the alcohol content and the numeric values differ by more than 0.5%, note the conflict explicitly in analysisNotes. Different abbreviation styles for the same number are NOT a conflict ("40% Alc./Vol." and "40% Alcohol by Volume" are identical; "40% Alc./Vol." and "46% Alc./Vol." are a conflict). Extract the value from the most prominent panel as alcoholContent, but always flag the numeric discrepancy.
  ✗ Wrong: "alcoholContent": "46% Alc./Vol." (silently picks one value, no mention of conflict)
  ✓ Right: "alcoholContent": "46% Alc./Vol.", analysisNotes: "CROSS-PANEL CONFLICT: Panel 1 states 46% Alc./Vol. but Panel 2 states 40% Alc./Vol. — numeric ABV values are inconsistent across panels."

C. NON-ENGLISH COUNTRY OF ORIGIN — return null
A foreign-language origin phrase (e.g. "PRODOTTO IN ITALIA", "Produit de France") does NOT satisfy the US CBP English-language requirement. Return null for countryOfOrigin and note the finding in analysisNotes. Do NOT translate or infer the English equivalent.
  ✗ Wrong: "countryOfOrigin": "Italy" ← inferred translation
  ✓ Right: "countryOfOrigin": null, analysisNotes: "Non-English origin statement found: 'PRODOTTO IN ITALIA' — English-language country of origin required by CBP; null returned."

D. PROCESS CLAIMS, SENSORY CLAIMS, AND AWARD CLAIMS — calibrate carefully
Routine production and sensory language is standard industry practice and must NOT be flagged (see DO NOT FLAG list above). Only flag claims that make a specific assertion requiring external verification.

  Flag for REVIEW — unverifiable award or ranking claims:
    [UNVERIFIABLE AWARD/RECOGNITION|REVIEW]: "Awarded #1 Vodka in America" — award claim with no named competition
    [UNVERIFIABLE AWARD/RECOGNITION|REVIEW]: "Gold Medal Winner" — award claim with no named competition or year
    [UNVERIFIABLE AWARD/RECOGNITION|REVIEW]: "World's Best Gin" — superlative ranking with no named award source

  Flag as FAIL — clear TTB violations:
    [HEALTH/THERAPEUTIC|FAIL]: "Boosts Heart Health" — explicit health benefit claim
    [EXCESSIVE DRINKING|FAIL]: "Drink More to Get Lit" — promotes dangerous overconsumption
    [EXCESSIVE DRINKING|FAIL]: "Gets You Wasted Fast" — explicitly promotes intoxication

E. BRAND NAME VS CLASS/TYPE — extract as separate fields
When the brand name and class/type designation appear together on the same line or design element, extract them as separate fields. Do not absorb the spirit type into the brand name.
  ✗ Wrong: "brandName": "ELEVATE GIN", "classType": null
  ✓ Right: "brandName": "ELEVATE", "classType": "GIN"

F. ALCOHOL CONTENT AS PROOF ONLY — extract verbatim, do not convert
If the label states only "80 Proof" or "100 PROOF" with no percentage, extract it verbatim. Do NOT calculate or infer the equivalent ABV percentage. Compliance format checking is handled downstream.
  ✗ Wrong: "alcoholContent": "40% Alc./Vol." ← calculated from proof number
  ✓ Right: "alcoholContent": "80 Proof"

I. IMPORT LABEL STICKER ON A FOREIGN BOTTLE — treat as a valid panel
A foreign-language bottle with a separate English-language import sticker is standard practice for imported products. Treat the import sticker as a full label panel. The government warning, importer statement, and country of origin on the sticker satisfy TTB/CBP requirements even if the bottle's main label is entirely in a foreign language. Extract all required fields from whichever panel they appear on.

━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY a valid JSON object with this exact structure:
{
  "rawText": "<all visible text from the label images, verbatim, in reading order — use ONLY '--- [Panel 1] ---', '--- [Panel 2] ---', etc. as separators; no filenames, no extra text in separators>",
  "confidence": <integer 0–100: your overall quality assessment of the submission — a general impression of how clearly the label text is readable across all panels>,
  "fieldConfidences": {
    "brandName": <0–100: readability of the brand name text on its clearest panel>,
    "classType": <0–100: readability of the class/type designation>,
    "alcoholContent": <0–100: readability of the alcohol content statement>,
    "netContents": <0–100: readability of the net contents statement>,
    "bottlerStatement": <0–100: readability of the bottler/importer name and address>,
    "governmentWarning": 0,
    "countryOfOrigin": <0–100: readability of the country of origin statement; use 100 for domestic products where it is not required>,
    "prohibitedClaims": <0–100: confidence that all marketing claims have been screened — lower if some text was unclear>
  },
  "extractedFields": {
    "brandName": "<brand name exactly as printed, or null>",
    "classType": "<full class/type designation exactly as printed including all modifiers, or null>",
    "alcoholContent": "<alcohol content statement exactly as printed (e.g. '40% Alc. by Vol.' or '40 ABV'), or null>",
    "netContents": "<net contents exactly as printed (e.g. '750 mL' or '750'), or null>",
    "bottlerStatement": "<full bottler/importer/brewer statement exactly as printed including qualifying verb and city/state, or null>",
    "governmentWarning": null,
    "governmentWarningLegible": false,
    "governmentWarningPanel": <1-indexed panel number where the "GOVERNMENT WARNING:" fine-print block is located, or null if not found on any panel>,
    "countryOfOrigin": "<country of origin exactly as printed for imported products (e.g. 'PRODUCT OF ENGLAND'), or null>",
    "prohibitedClaims": "<pipe-separated list of ALL detected violations across ALL panels in format '[CATEGORY|SEVERITY]: \\"exact claim text\\" — reason'; CATEGORY is one of HEALTH/THERAPEUTIC, INTOXICATION/EXCESSIVE DRINKING, ORGANIC WITHOUT CERTIFICATION, FALSE GEOGRAPHIC/PRODUCTION, OBSCENE/OFFENSIVE/ILLEGAL, MISLEADING QUALITY CLAIM, UNVERIFIABLE AWARD/RECOGNITION, MISLEADING HEALTH IMPLICATION, MISLEADING OVERALL IMPRESSION, MISLEADING NUTRIENT; SEVERITY is FAIL or REVIEW; null if none detected after scanning all panels>"
  },
  "analysisNotes": "<note image quality issues, partially obscured text, non-standard formats, which panel each key element was found on, and any discrepancies with application data; do NOT report prohibited claims here>"
}

Do not infer, complete, or reformat any text. Return null when text is absent or unreadable.`;

function buildPanelManifest(panels: Pick<PanelImage, "fileName">[]): string {
  if (panels.length === 0) return "";
  const lines = panels.map((p, i) => `  Image ${i + 1}: "${p.fileName ?? "unknown"}"`).join("\n");
  return `Panels in this submission:
${lines}

For each panel, visually inspect the image and classify it as one of:
  (A) FLAT LABEL SCAN — 2D image of a label surface lying flat or photographed face-on; text is rectilinear and unambiguous. Use as a PRIMARY source.
  (B) CLOSE-UP LABEL PHOTO — high-resolution close-up of a label on a bottle or can; treat as a PRIMARY source.
  (C) PRODUCT PHOTOGRAPH — a bottle or can photographed in a 3D real-world or staged setting; the label wraps around a curved surface and the image may have depth-of-field blur, glare, or perspective distortion. Use as SUPPLEMENTARY CONTEXT only.

Apply source priority accordingly. For panels classified as (C), pay close attention to any fine-print regulatory text (alcohol content, net contents, bottler statement) that appears near the bottom of the visible label area — this mandatory text is often printed small and may require extra care to read from a 3D photograph.`;
}

const buildUserPrompt = (
  appData: ApplicationData | null,
  panels: Pick<PanelImage, "fileName">[]
) => `
Analyze ${panels.length === 1 ? "this alcohol beverage label image" : `these ${panels.length} alcohol beverage label panel images`} and extract all mandatory TTB label information per the FAA Act and 27 CFR Parts 4, 5, and 7.

${panels.length > 1 ? `The images show different panels of the same product label (e.g. front, back, neck, cap). Treat them as a single submission — a required field present on ANY panel satisfies the requirement.\n` : ""}${buildPanelManifest(panels) + "\n"}
${appData ? `
Application data on file for comparison:
- Brand Name: ${appData.brandName || "(not provided)"}
- Class/Type: ${appData.classType || "(not provided)"}
- Alcohol Content: ${appData.alcoholContent || "(not provided)"}
- Net Contents: ${appData.netContents || "(not provided)"}
- Bottler/Importer: ${appData.bottlerAddress ?? (appData.bottlerName ? `${appData.bottlerName}, ${appData.bottlerCity || ""}, ${appData.bottlerState || ""}` : `${appData.bottlerCity || ""}, ${appData.bottlerState || ""}`)}
- Is Imported: ${appData.isImported ? "Yes" : "No"}
- Country of Origin: ${appData.countryOfOrigin || "N/A"}

Compare each extracted field against the application data and flag any discrepancies in analysisNotes.
` : "No application data provided — perform format-only validation against TTB requirements."}

Respond with the JSON object defined in the OUTPUT FORMAT section of your instructions.`;

export interface AiAnalysisResult {
  rawText: string;
  /** Overall confidence — equals the minimum of all per-field confidences. */
  confidence: number;
  /** Individual confidence score for each extracted field (0–100). */
  fieldConfidences: {
    brandName: number;
    classType: number;
    alcoholContent: number;
    netContents: number;
    bottlerStatement: number;
    governmentWarning: number;
    countryOfOrigin: number;
    prohibitedClaims: number;
  };
  extractedFields: {
    brandName: string | null;
    classType: string | null;
    alcoholContent: string | null;
    netContents: string | null;
    bottlerStatement: string | null;
    /** Always null — government warning text is extracted by OCR, not AI. */
    governmentWarning: string | null;
    /** Always false — government warning is handled by OCR, not AI. */
    governmentWarningLegible: boolean;
    /** 1-indexed panel number where the "GOVERNMENT WARNING:" block is located, or null if not found. */
    governmentWarningPanel?: number | null;
    countryOfOrigin: string | null;
    /** Pipe-separated list of prohibited/potentially prohibited claims detected, or null if none */
    prohibitedClaims: string | null;
  };
  analysisNotes: string;
}

export interface PanelImage {
  base64: string;
  mimeType: string;
  /** Original filename (e.g. "frontLabel.png") — used to label each image for the AI
   *  so it can correctly apply the confidence hierarchy (flat scan vs. product photo) */
  fileName?: string;
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
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 800,
    system: APP_DOC_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: doc.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: doc.base64,
            },
          },
          { type: "text", text: APP_DOC_USER_PROMPT },
        ],
      },
    ],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") throw new Error("Claude returned an empty response.");

  const parsed = JSON.parse(block.text);

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
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    // Keep SDK retries low so that a throttled request fails fast and our
    // batch-queue retry logic (with its smarter 20 s wait) takes over quickly.
    maxRetries: 1,
    // Claude Haiku is fast but give ample timeout for multi-panel labels.
    timeout: 120_000,
  });

  // Send images as inline base64 blocks.  Panel identification is conveyed
  // through the text prompt so filenames cannot be mistaken for label content.
  const imageBlocks: Anthropic.ImageBlockParam[] = panels.map((panel) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: panel.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      data: panel.base64,
    },
  }));

  // Typical label response is 1,000–2,000 tokens of JSON.  3,000 gives a safe
  // 2× margin.
  //
  // Prompt caching: the system prompt is ~6,700 tokens and identical across every
  // label.  Marking it with cache_control tells Anthropic to store it for 5 minutes.
  // The first call in a session pays a 25% write surcharge; every subsequent call
  // within that window reads from cache at 10% of normal cost and skips processing
  // those tokens entirely, cutting per-label latency from ~11 s → ~3–5 s.
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 3000,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: buildUserPrompt(appData, panels),
          },
        ],
      },
    ],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Claude returned an empty response.");
  }

  // Claude may occasionally wrap the JSON in a markdown code fence even when
  // instructed not to — strip it defensively before parsing.
  const rawContent = block.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  const parsed = JSON.parse(rawContent) as AiAnalysisResult;

  // Strip panel separator markers that Claude sometimes incorrectly injects into field values.
  // Handles all observed variants:
  //   "--- [Panel 1] ---"                (standard)
  //   "--- [Panel 1: filename.png] ---"  (with filename)
  //   "[Panel 1]"                        (no dashes)
  //   Bare filenames like "bellaVistaLabel1.png"
  const sanitize = (value: string | null | undefined): string | null => {
    if (!value) return null;
    const trimmed = value.trim();
    // Null out bare filenames (e.g. "bellaVistaLabel1.png")
    if (/^[\w\s-]+\.\w{2,5}$/i.test(trimmed)) return null;
    // Strip all panel/image bracket markers with or without surrounding dashes
    const cleaned = trimmed
      .replace(/(?:---\s*)?\[(?:Panel|Image)\s*\d+[^\]]*\](?:\s*---)?/gi, "")
      .replace(/^\s*[-—]+\s*|\s*[-—]+\s*$/g, "")
      .trim();
    return cleaned || null;
  };

  // Use the model's general quality score as the neutral fallback for any field that
  // the model did not individually score. This prevents one field's low score from
  // bleeding into unrelated fields through the default.
  const generalConf = typeof parsed.confidence === "number" ? parsed.confidence : 75;
  const pfc = parsed.fieldConfidences ?? {};

  // Government warning is always null from AI — OCR handles this field client-side.
  // The confidence is always 0 here; the OCR path patches it after this call returns.

  const fieldConfidences = {
    brandName:         typeof pfc.brandName         === "number" ? pfc.brandName         : generalConf,
    classType:         typeof pfc.classType         === "number" ? pfc.classType         : generalConf,
    alcoholContent:    typeof pfc.alcoholContent    === "number" ? pfc.alcoholContent    : generalConf,
    netContents:       typeof pfc.netContents       === "number" ? pfc.netContents       : generalConf,
    bottlerStatement:  typeof pfc.bottlerStatement  === "number" ? pfc.bottlerStatement  : generalConf,
    governmentWarning: 0,
    // Domestic products don't require a country of origin — absence is a rule-based
    // pass, not a readability issue, so confidence is 100% when not imported.
    countryOfOrigin: parsed.extractedFields?.countryOfOrigin == null && !appData?.isImported
      ? 100
      : (typeof pfc.countryOfOrigin === "number" ? pfc.countryOfOrigin : generalConf),
    // Use AI's reported confidence for prohibited claims — pass/fail is now determined
    // solely by whether the AI found claim markers, not by the confidence level.
    prohibitedClaims: typeof pfc.prohibitedClaims === "number" ? pfc.prohibitedClaims : generalConf,
  };
  // Overall confidence = weakest AI-read field. Government warning is excluded because
  // it is always 0 by design (OCR handles it) and must not drag down the AI's overall score.
  const { governmentWarning: _gw, ...aiOnlyConfidences } = fieldConfidences;
  const overallConfidence = Math.min(...Object.values(aiOnlyConfidences));

  return {
    rawText: parsed.rawText ?? "",
    confidence: overallConfidence,
    fieldConfidences,
    extractedFields: {
      brandName: sanitize(parsed.extractedFields?.brandName),
      classType: sanitize(parsed.extractedFields?.classType),
      alcoholContent: sanitize(parsed.extractedFields?.alcoholContent),
      netContents: sanitize(parsed.extractedFields?.netContents),
      bottlerStatement: sanitize(parsed.extractedFields?.bottlerStatement),
      // AI always returns null for the warning — OCR handles this field client-side.
      governmentWarning: null,
      governmentWarningLegible: false,
      governmentWarningPanel: typeof parsed.extractedFields?.governmentWarningPanel === "number"
        ? parsed.extractedFields.governmentWarningPanel
        : null,
      countryOfOrigin: sanitize(parsed.extractedFields?.countryOfOrigin),
      prohibitedClaims: sanitize(parsed.extractedFields?.prohibitedClaims),
    },
    analysisNotes: parsed.analysisNotes ?? "",
  };
}
