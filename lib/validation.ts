/**
 * TTB Compliance Validation Engine
 * Implements all 7 validation rules per PRD section 7.
 */

import { FieldValidationResult, ApplicationData, ValidationStatus } from "./types";
import { ParsedFields } from "./field-parser";

const REQUIRED_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

// Matches both "NUMBER% Alc./Vol." and "Alc. NUMBER% by Vol." orderings, plus proof-only.
const ALCOHOL_CONTENT_VALID_REGEX =
  /\d{1,3}(?:\.\d{1,2})?\s*%\s*(?:alc(?:ohol)?\.?\s*(?:[/\\]\s*vol(?:ume)?\.?|\s+by\s+vol(?:ume)?\.?)?|alcohol\s+by\s+volume|abv)|alc(?:ohol)?\.?\s*\d{1,3}(?:\.\d{1,2})?\s*%\s*(?:by\s+)?vol(?:ume)?\.?|\d{2,3}\s*proof/i;

// Matches "40 ABV" (no percent sign) — non-compliant; distinct from "40% ABV" which is accepted
const ABV_ONLY_REGEX = /\b\d+(?:\.\d+)?\s+abv\b/i;
const NET_CONTENTS_VALID_REGEX = /\d{1,4}(?:\.\d{1,2})?\s*(?:ml|milliliter|millilitre|l\b|liter|litre)/i;
// Matches single qualifiers ("Bottled by", "Canned by") and compound qualifiers
// ("Distilled and Bottled by", "Produced and Canned by", "Brewed and Packaged by").
const BOTTLER_QUALIFIER_VERB = /bottled|distilled|produced|imported|packaged|canned|brewed|manufactured|rectified/i;
const BOTTLER_QUALIFIER_REGEX = new RegExp(
  `(?:${BOTTLER_QUALIFIER_VERB.source})(?:\\s+and\\s+(?:${BOTTLER_QUALIFIER_VERB.source}))?\\s+by`,
  "i"
);
const STATE_ABBR_REGEX = /\b[A-Z]{2}\b/;
const CITY_STATE_REGEX = /[A-Za-z\s]+,\s*[A-Z]{2}/;

// Full US state name → two-letter abbreviation for normalisation before comparison.
const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca",
  colorado: "co", connecticut: "ct", delaware: "de", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia",
  kansas: "ks", kentucky: "ky", louisiana: "la", maine: "me", maryland: "md",
  massachusetts: "ma", michigan: "mi", minnesota: "mn", mississippi: "ms",
  missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv", "new hampshire": "nh",
  "new jersey": "nj", "new mexico": "nm", "new york": "ny", "north carolina": "nc",
  "north dakota": "nd", ohio: "oh", oklahoma: "ok", oregon: "or", pennsylvania: "pa",
  "rhode island": "ri", "south carolina": "sc", "south dakota": "sd", tennessee: "tn",
  texas: "tx", utah: "ut", vermont: "vt", virginia: "va", washington: "wa",
  "west virginia": "wv", wisconsin: "wi", wyoming: "wy",
};

/** Replace full state names with their two-letter abbreviation for uniform comparison. */
function normalizeStates(text: string): string {
  let result = text.toLowerCase();
  for (const [name, abbr] of Object.entries(STATE_NAME_TO_ABBR)) {
    result = result.replace(new RegExp(`\\b${name}\\b`, "g"), abbr);
  }
  return result;
}

/**
 * Returns true if two words are considered equivalent for bottler matching.
 * Handles exact matches and single-character OCR typos (Levenshtein ≤ 1 for
 * words longer than 4 characters, or ≤ 2 for words longer than 8 characters).
 */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const maxDist = a.length > 8 ? 2 : a.length > 4 ? 1 : 0;
  return maxDist > 0 && levenshtein(a, b) <= maxDist;
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
  }
  return matrix[b.length][a.length];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const dist = levenshtein(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

export interface ValidationResults {
  brandName: FieldValidationResult;
  classType: FieldValidationResult;
  alcoholContent: FieldValidationResult;
  netContents: FieldValidationResult;
  bottlerImporter: FieldValidationResult;
  governmentWarning: FieldValidationResult;
  countryOfOrigin: FieldValidationResult;
  prohibitedClaims: FieldValidationResult;
  fieldOfVision: FieldValidationResult;
}

/** Per-field confidence scores (0–100). When a field score is omitted, `default` is used. */
export interface FieldConfidences {
  brandName?: number;
  classType?: number;
  alcoholContent?: number;
  netContents?: number;
  bottlerStatement?: number;
  governmentWarning?: number;
  countryOfOrigin?: number;
  prohibitedClaims?: number;
  /** Fallback used for any field without an explicit score */
  default: number;
}

function fc(confidences: FieldConfidences, field: keyof Omit<FieldConfidences, "default">): number {
  return confidences[field] ?? confidences.default;
}

export function validateLabel(
  parsed: ParsedFields,
  appData: ApplicationData,
  confidences: FieldConfidences | number,
  options?: { usedAi?: boolean }
): ValidationResults {
  const conf: FieldConfidences =
    typeof confidences === "number" ? { default: confidences } : confidences;
  const usedAi = options?.usedAi ?? false;
  return {
    brandName: validateBrandName(parsed, appData, fc(conf, "brandName")),
    classType: validateClassType(parsed, appData, fc(conf, "classType")),
    alcoholContent: validateAlcoholContent(parsed, appData, fc(conf, "alcoholContent")),
    netContents: validateNetContents(parsed, appData, fc(conf, "netContents")),
    bottlerImporter: validateBottlerImporter(parsed, appData, fc(conf, "bottlerStatement")),
    governmentWarning: validateGovernmentWarning(parsed, fc(conf, "governmentWarning")),
    countryOfOrigin: validateCountryOfOrigin(parsed, appData, fc(conf, "countryOfOrigin")),
    prohibitedClaims: validateProhibitedClaims(parsed, fc(conf, "prohibitedClaims"), usedAi),
    fieldOfVision: validateFieldOfVision(parsed, conf.default),
  };
}

/** Returns the minimum confidence across all validated fields — used as the displayed overall confidence. */
export function computeOverallConfidence(results: ValidationResults): number {
  return Math.min(...Object.values(results).map((r) => r.confidence));
}

function makeResult(
  field: string,
  status: ValidationStatus,
  extractedValue: string | null,
  expectedValue: string | null,
  confidence: number,
  message: string,
  detail?: string
): FieldValidationResult {
  return { field, status, extractedValue, expectedValue, confidence, message, detail };
}

function applyConfidenceGate(
  confidence: number,
  result: FieldValidationResult
): FieldValidationResult {
  // Image is substantially degraded — extracted values cannot be trusted even if
  // they look plausible. Any passing field must be failed outright.
  if (confidence < 50 && result.status === "pass") {
    return {
      ...result,
      status: "fail",
      message: `Image quality too poor for reliable extraction (confidence: ${confidence.toFixed(0)}%). Field value cannot be verified — resubmit a legible label image.`,
    };
  }
  // Moderate degradation — flag passing fields for human review.
  if (confidence < 70 && result.status === "pass") {
    return {
      ...result,
      status: "review",
      message: `Confidence ${confidence.toFixed(0)}% is below the reliable-read threshold. Manual review recommended.`,
    };
  }
  return result;
}

// Returns true when one brand name is a distinct phrase within the other.
// Handles both directions:
//   - expected inside extracted: expected "Elevate" found within extracted "ELEVATE PREMIUM GIN"
//   - extracted inside expected: extracted "PINE RIDGE" found within expected "Pine Ridge Distilling Co."
function brandContainsExpected(extracted: string, expected: string): boolean {
  const escapedExpected = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedExtracted = extracted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fwd = new RegExp(`(?:^|[^a-zA-Z0-9])${escapedExpected}(?:$|[^a-zA-Z0-9])`, "i");
  const rev = new RegExp(`(?:^|[^a-zA-Z0-9])${escapedExtracted}(?:$|[^a-zA-Z0-9])`, "i");
  return fwd.test(extracted) || rev.test(expected);
}

// 7.1 Brand Name Validation
function validateBrandName(
  parsed: ParsedFields,
  appData: ApplicationData,
  ocrConfidence: number
): FieldValidationResult {
  const extracted = parsed.brandName;
  const expected = appData.brandName?.trim();

  if (!extracted) {
    return makeResult("Brand Name", "fail", null, expected || null, ocrConfidence,
      "Brand name could not be detected on the label.", "Ensure the brand name is clearly visible.");
  }

  if (!expected) {
    return makeResult("Brand Name", "review", extracted, null, ocrConfidence,
      "Brand name detected but no application data provided for comparison.", extracted);
  }

  // Pass if either string is a distinct phrase within the other:
  //   "Elevate" in "ELEVATE PREMIUM GIN" — label shows brand + tagline
  //   "PINE RIDGE" in "Pine Ridge Distilling Co." — label omits corporate suffix
  if (brandContainsExpected(extracted, expected)) {
    return applyConfidenceGate(ocrConfidence, makeResult(
      "Brand Name", "pass", extracted, expected, ocrConfidence,
      "Brand name matches application data.",
      `"${extracted}" matches "${expected}"`
    ));
  }

  const sim = similarity(extracted, expected);
  if (sim >= 0.85) {
    return applyConfidenceGate(ocrConfidence, makeResult(
      "Brand Name", "pass", extracted, expected, ocrConfidence,
      `Brand name matches application data.`, `"${extracted}" matches "${expected}"`
    ));
  } else if (sim >= 0.6) {
    return makeResult("Brand Name", "review", extracted, expected, ocrConfidence,
      "Brand name may not match application data. Manual review recommended.",
      `Extracted: "${extracted}" | Expected: "${expected}" | Similarity: ${(sim * 100).toFixed(0)}%`);
  } else {
    return makeResult("Brand Name", "fail", extracted, expected, ocrConfidence,
      "Brand name does not match application data.",
      `Extracted: "${extracted}" | Expected: "${expected}"`);
  }
}

// Groups of mutually-exclusive spirit types. Two designations from different groups are
// incompatible (e.g. Vodka vs Gin), which should be a hard fail rather than a review.
// Within the same group, qualifier words like "Premium", "Straight", "Kentucky" are acceptable.
const SPIRIT_TYPE_GROUPS: string[][] = [
  ["whiskey", "whisky", "bourbon", "rye", "scotch", "tennessee", "irish", "malt whisky", "malt whiskey"],
  ["vodka"],
  ["gin"],
  ["rum"],
  ["tequila", "mezcal"],
  ["brandy", "cognac", "armagnac", "pisco"],
  ["liqueur", "cordial", "triple sec", "schnapps", "amaro"],
  ["wine", "rosso", "bianco", "bordeaux", "chardonnay", "merlot", "cabernet", "pinot", "shiraz", "syrah", "riesling", "sauvignon", "prosecco", "champagne", "igt", "aoc", "blanc", "rouge", "rosé", "rose", "vino", "spumante", "cava", "port", "sherry", "barolo", "chianti", "rioja"],
  ["beer", "ale", "lager", "stout", "porter", "ipa", "india pale ale", "pilsner", "seltzer", "hard seltzer", "malt beverage", "cider"],
];

function getSpiritGroup(typeStr: string): number | null {
  const lower = typeStr.toLowerCase();
  for (let i = 0; i < SPIRIT_TYPE_GROUPS.length; i++) {
    if (SPIRIT_TYPE_GROUPS[i].some((kw) => lower.includes(kw))) return i;
  }
  return null;
}

// 7.2 Class/Type Designation Validation
function validateClassType(
  parsed: ParsedFields,
  appData: ApplicationData,
  ocrConfidence: number
): FieldValidationResult {
  const extracted = parsed.classType;
  const expected = appData.classType?.trim();

  if (!extracted) {
    return makeResult("Class/Type", "fail", null, expected || null, ocrConfidence,
      "No valid TTB class/type designation found on label.",
      "Must include a recognized designation such as Vodka, Whiskey, Rum, etc.");
  }

  if (!expected) {
    return applyConfidenceGate(ocrConfidence, makeResult(
      "Class/Type", "pass", extracted, null, ocrConfidence,
      "Class/type designation detected.", extracted
    ));
  }

  const extractedGroup = getSpiritGroup(extracted);
  const expectedGroup = getSpiritGroup(expected);

  // If both types are identifiable but belong to different spirit groups, it is a hard fail.
  // (e.g. "Gin" on label vs "Vodka" in application — these are incompatible designations.)
  if (extractedGroup !== null && expectedGroup !== null && extractedGroup !== expectedGroup) {
    return makeResult("Class/Type", "fail", extracted, expected, ocrConfidence,
      "Class/type designation does not match application data. The spirit types are incompatible.",
      `Label shows "${extracted}" but application specifies "${expected}"`);
  }

  const sim = similarity(extracted, expected);
  const extractedLower = extracted.toLowerCase();
  const expectedLower = expected.toLowerCase();
  // Pass when one designation contains the other — handles "PREMIUM VODKA" vs "Vodka",
  // "Kentucky Straight Bourbon Whiskey" vs "Bourbon Whiskey", "London Dry Gin" vs "Gin", etc.
  const containsMatch =
    extractedLower.includes(expectedLower) || expectedLower.includes(extractedLower);

  if (sim >= 0.75 || containsMatch) {
    return applyConfidenceGate(ocrConfidence, makeResult(
      "Class/Type", "pass", extracted, expected, ocrConfidence,
      "Class/type designation matches application data.", `"${extracted}"`
    ));
  }

  return makeResult("Class/Type", "fail", extracted, expected, ocrConfidence,
    "Class/type designation does not match application data.",
    `Extracted: "${extracted}" | Expected: "${expected}"`);
}

// 7.3 Alcohol Content Validation
function validateAlcoholContent(
  parsed: ParsedFields,
  appData: ApplicationData,
  ocrConfidence: number
): FieldValidationResult {
  const extracted = parsed.alcoholContent;
  const expected = appData.alcoholContent?.trim();

  if (!extracted) {
    // Check for ABV-only format
    if (parsed.rawText && ABV_ONLY_REGEX.test(parsed.rawText)) {
      const match = parsed.rawText.match(ABV_ONLY_REGEX);
      return makeResult("Alcohol Content", "fail", match ? match[0] : null, expected || null, ocrConfidence,
        `"ABV" alone is not a permitted format. Must include "% Alc. by Vol." or "% Alcohol by Volume".`,
        'Example of valid format: "40% Alc. by Vol."');
    }
    return makeResult("Alcohol Content", "fail", null, expected || null, ocrConfidence,
      "Alcohol content statement not found on label.",
      'Required format: "40% Alc. by Vol." or "15.5% Alcohol by Volume"');
  }

  if (!ALCOHOL_CONTENT_VALID_REGEX.test(extracted)) {
    return makeResult("Alcohol Content", "fail", extracted, expected || null, ocrConfidence,
      "Alcohol content format does not meet TTB requirements.",
      `Detected: "${extracted}". Must include %, "Alc." or "Alcohol", and "Vol." or "Volume".`);
  }

  if (expected) {
    const extractedNum = extracted.match(/\d+(?:\.\d+)?/)?.[0];
    const expectedNum = expected.match(/\d+(?:\.\d+)?/)?.[0];
    if (extractedNum && expectedNum && Math.abs(parseFloat(extractedNum) - parseFloat(expectedNum)) > 0.5) {
      return makeResult("Alcohol Content", "fail", extracted, expected, ocrConfidence,
        "Alcohol percentage does not match application data.",
        `Label shows ${extractedNum}% but application states ${expectedNum}%`);
    }
  }

  return applyConfidenceGate(ocrConfidence, makeResult(
    "Alcohol Content", "pass", extracted, expected || null, ocrConfidence,
    "Alcohol content statement meets TTB format requirements.", extracted
  ));
}

// 7.4 Net Contents Validation
function validateNetContents(
  parsed: ParsedFields,
  appData: ApplicationData,
  ocrConfidence: number
): FieldValidationResult {
  const extracted = parsed.netContents;
  const expected = appData.netContents?.trim();

  if (!extracted) {
    return makeResult("Net Contents", "fail", null, expected || null, ocrConfidence,
      "Net contents statement not found or not in metric format.",
      'Required format: "750 mL" or "1.75 L". Non-metric measurements alone are not permitted.');
  }

  if (!NET_CONTENTS_VALID_REGEX.test(extracted)) {
    return makeResult("Net Contents", "fail", extracted, expected || null, ocrConfidence,
      "Net contents must be in metric units (mL or L).",
      `Detected: "${extracted}"`);
  }

  if (expected) {
    const sim = similarity(extracted.replace(/\s/g, ""), expected.replace(/\s/g, ""));
    if (sim < 0.7) {
      return makeResult("Net Contents", "review", extracted, expected, ocrConfidence,
        "Net contents may not match application data.",
        `Extracted: "${extracted}" | Expected: "${expected}"`);
    }
  }

  return applyConfidenceGate(ocrConfidence, makeResult(
    "Net Contents", "pass", extracted, expected || null, ocrConfidence,
    "Net contents statement is present and in metric format.", extracted
  ));
}

// 7.5 Bottler/Importer Validation
function validateBottlerImporter(
  parsed: ParsedFields,
  appData: ApplicationData,
  ocrConfidence: number
): FieldValidationResult {
  const expectedName = appData.bottlerName?.trim() ?? null;
  const expectedCity = appData.bottlerCity?.trim();
  const expectedState = appData.bottlerState?.trim();

  // extracted is now just company name + address (qualifier stripped at extraction time).
  // Defensively strip any residual qualifier prefix in case old data or model non-compliance.
  const rawExtracted = parsed.bottlerStatement;
  const extracted = rawExtracted
    ? rawExtracted.replace(BOTTLER_QUALIFIER_REGEX, "").replace(/^[\s|,–—]+/, "").trim() || rawExtracted
    : null;

  if (!extracted) {
    const expectedValue = appData.bottlerAddress
      ?? (expectedName ? `${expectedName}, ${expectedCity}, ${expectedState}`
      : (expectedCity ? `${expectedCity}, ${expectedState}` : null));
    return makeResult("Bottler/Importer", "fail", null, expectedValue,
      ocrConfidence,
      'Missing bottler/importer statement. Must include qualifying phrase ("Bottled by", "Distilled by", "Imported by") followed by company name, city, and state.',
      'Example: "Bottled by Bright Distillery, Boston, MA"');
  }

  // Qualifier presence is checked in rawText (where the full label text lives) since
  // the extracted value no longer includes the qualifying phrase itself.
  const hasQualifier = BOTTLER_QUALIFIER_REGEX.test(parsed.rawText ?? "");
  const hasCityState = CITY_STATE_REGEX.test(extracted);
  const hasStateAbbr = STATE_ABBR_REGEX.test(extracted);

  if (!hasQualifier) {
    return makeResult("Bottler/Importer", "fail", extracted, null, ocrConfidence,
      'Missing qualifying phrase on label. Must include "Bottled by", "Distilled by", or "Imported by".',
      `Detected company text: "${extracted}"`);
  }

  if (!hasCityState && !hasStateAbbr) {
    return makeResult("Bottler/Importer", "fail", extracted, null, ocrConfidence,
      "Missing city and state abbreviation in bottler/importer statement.",
      `Detected: "${extracted}". Must include city and two-letter state abbreviation.`);
  }

  // Check against bottlerAddress (combined name + address) if provided — preferred over
  // the legacy expectedName check since it contains both company name and location.
  if (appData.bottlerAddress) {
    // Normalise state names (e.g. "OREGON" → "or") before comparison so that full
    // state names and two-letter abbreviations are treated as identical.
    const extractedNorm = normalizeStates(extracted);
    const addressNorm   = normalizeStates(appData.bottlerAddress);

    const extractedTokens = extractedNorm.split(/\W+/).filter((w) => w.length > 3);
    const significantWords = addressNorm.split(/\W+/).filter((w) => w.length > 3);

    // A significant word "matches" if the extracted text contains an exact token or
    // a token within Levenshtein distance 1–2 (handles single-character OCR typos).
    const matchingWords = significantWords.filter((expected) =>
      extractedTokens.some((got) => wordsMatch(got, expected))
    );
    const wordOverlap = significantWords.length > 0 ? matchingWords.length / significantWords.length : 0;

    if (wordOverlap < 0.6) {
      return makeResult("Bottler/Importer", "fail", extracted, appData.bottlerAddress, ocrConfidence,
        "Bottler/importer information on label does not match application data.",
        `Extracted: "${extracted}" | Expected: "${appData.bottlerAddress}"`);
    }
    if (wordOverlap < 0.9) {
      return makeResult("Bottler/Importer", "review", extracted, appData.bottlerAddress, ocrConfidence,
        "Bottler/importer information may not fully match application data. Manual review recommended.",
        `Extracted: "${extracted}" | Expected: "${appData.bottlerAddress}"`);
    }
    return applyConfidenceGate(ocrConfidence, makeResult(
      "Bottler/Importer", "pass", extracted, appData.bottlerAddress, ocrConfidence,
      "Bottler/importer statement matches application data.", extracted
    ));
  }

  // Legacy check — used when bottlerAddress is not set but bottlerName is
  if (expectedName) {
    const extractedLower = extracted.toLowerCase();
    const expectedLower = expectedName.toLowerCase();
    const exactMatch = extractedLower.includes(expectedLower) || expectedLower.includes(extractedLower);

    if (!exactMatch) {
      const significantWords = expectedLower.split(/\W+/).filter((w) => w.length > 3);
      const matchingWords = significantWords.filter((w) => extractedLower.includes(w));
      const wordOverlap = significantWords.length > 0 ? matchingWords.length / significantWords.length : 0;
      const expectedFull = `${expectedName}, ${expectedCity}, ${expectedState}`;

      if (wordOverlap >= 0.8) {
        return makeResult("Bottler/Importer", "review", extracted, expectedFull, ocrConfidence,
          "Bottler/importer name appears to be a variation of the application data. Confirm they are the same entity.",
          `Extracted: "${extracted}" | Expected: "${expectedName}"`);
      } else {
        return makeResult("Bottler/Importer", "fail", extracted, expectedFull, ocrConfidence,
          "Bottler/importer on label does not match application data.",
          `Extracted: "${extracted}" | Expected: "${expectedName}"`);
      }
    }
  }

  return applyConfidenceGate(ocrConfidence, makeResult(
    "Bottler/Importer", "pass", extracted,
    expectedName ? `${expectedName}, ${expectedCity}, ${expectedState}` : null,
    ocrConfidence,
    "Bottler/importer statement is present with required formatting.", extracted
  ));
}

// 7.6 Government Warning Validation
export function validateGovernmentWarning(
  parsed: ParsedFields,
  ocrConfidence: number
): FieldValidationResult {
  const extracted = parsed.governmentWarning;

  // Hard legibility gate — if the AI explicitly attested that the warning was not fully
  // legible, fail regardless of any text value. This catches hallucinated text that
  // slipped through with governmentWarningLegible: false, and also serves as a
  // belt-and-suspenders check for the null-out logic in ai-analyzer.ts.
  if (parsed.governmentWarningLegible === false) {
    return makeResult(
      "Government Warning", "fail",
      extracted, "GOVERNMENT WARNING: (1)...(2)...", ocrConfidence,
      "Government warning could not be verified — the label image did not allow every word to be read with certainty.",
      "Resubmit with a clearer image of the panel containing the government warning."
    );
  }

  if (!extracted) {
    return makeResult("Government Warning", "fail", null, "GOVERNMENT WARNING: (1)...(2)...", ocrConfidence,
      "Government warning statement is missing from the label.",
      "Both warning sections are required: pregnancy risk and impaired driving/machinery.");
  }

  // Check for proper capitalization of "GOVERNMENT WARNING"
  const hasProperCapitalization = /GOVERNMENT\s+WARNING/i.test(extracted);
  const hasCorrectCase = extracted.includes("GOVERNMENT WARNING");

  if (!hasCorrectCase && hasProperCapitalization) {
    return makeResult("Government Warning", "fail", extracted, REQUIRED_WARNING, ocrConfidence,
      '"GOVERNMENT WARNING" must be in all capitals.',
      `Detected: "${extracted.substring(0, 50)}..."`);
  }

  // Check for both sections
  const hasSection1 = /\(1\)/i.test(extracted) || /surgeon\s+general/i.test(extracted) || /birth\s+defects/i.test(extracted);
  const hasSection2 = /\(2\)/i.test(extracted) || /impairs/i.test(extracted) || /drive\s+a\s+car/i.test(extracted);

  if (!hasSection1) {
    return makeResult("Government Warning", "fail", extracted, REQUIRED_WARNING, ocrConfidence,
      "Warning section (1) about pregnancy risk is missing or incomplete.",
      "Required: Surgeon General warning about pregnancy and birth defects.");
  }

  if (!hasSection2) {
    return makeResult("Government Warning", "fail", extracted, REQUIRED_WARNING, ocrConfidence,
      "Warning section (2) about driving/machinery impairment is missing or incomplete.",
      "Required: Warning about impaired driving and machinery operation.");
  }

  // Normalize both strings before comparing — lowercase and collapse whitespace so that minor
  // capitalization or spacing differences in the body text do not count as violations.
  // Only the "GOVERNMENT WARNING:" header must be in all capitals (checked above).
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const sim = similarity(normalize(extracted), normalize(REQUIRED_WARNING));

  // The warning words must match the required statement. Spacing and capitalization
  // differences in the body are acceptable; substantive word changes are a compliance failure.
  if (sim < 0.95) {
    return makeResult("Government Warning", "fail", extracted, REQUIRED_WARNING, ocrConfidence,
      "Government warning text does not match the required statement. The warning words must match — minor spacing or capitalization differences in the body are acceptable but missing or changed words are not.",
      `Word-level similarity: ${(sim * 100).toFixed(0)}% (after normalizing case and spacing). Required: ≥95%.`);
  }

  // When the warning was extracted by Tesseract OCR (governmentWarningLegible === undefined),
  // the ≥95% similarity match above is the definitive quality gate — Tesseract read the text
  // correctly if it matches. OCR confidence scores for fine-print text are systematically lower
  // than GPT's self-reported scores and would cause false reviews on clear labels, so the
  // confidence gate is skipped on the OCR path.
  // On the AI path (governmentWarningLegible === true), keep the confidence gate to guard
  // against hallucinated text that was accepted with an inflated self-reported confidence score.
  if (parsed.governmentWarningLegible === undefined) {
    return makeResult(
      "Government Warning", "pass", extracted, REQUIRED_WARNING, ocrConfidence,
      "Government warning statement verified by OCR — text matches required wording.",
      `Word-level similarity: ${(sim * 100).toFixed(0)}%`
    );
  }

  return applyConfidenceGate(ocrConfidence, makeResult(
    "Government Warning", "pass", extracted, REQUIRED_WARNING, ocrConfidence,
    "Government warning statement detected with both required sections.",
    `Word-level similarity: ${(sim * 100).toFixed(0)}%`
  ));
}

// 7.7 Country of Origin Validation
function validateCountryOfOrigin(
  parsed: ParsedFields,
  appData: ApplicationData,
  ocrConfidence: number
): FieldValidationResult {
  const extracted = parsed.countryOfOrigin;
  const isImported = appData.isImported;
  const expected = appData.countryOfOrigin?.trim();

  if (!isImported) {
    // Not required for domestic products
    if (extracted) {
      return makeResult("Country of Origin", "pass", extracted, null, ocrConfidence,
        "Country of origin detected (domestic product).", extracted);
    }
    return makeResult("Country of Origin", "pass", null, null, ocrConfidence,
      "Country of origin not required for domestic products.", "N/A");
  }

  // Imported product — country of origin is required
  if (!extracted) {
    return makeResult("Country of Origin", "fail", null, expected || "Required", ocrConfidence,
      "Country of origin is required for imported products but was not detected.");
  }

  if (expected) {
    const sim = similarity(extracted, expected);
    const extractedLower = extracted.toLowerCase();
    const expectedLower = expected.toLowerCase();
    // Pass when the label uses a fuller phrase that contains the expected country
    // (e.g. "PRODUCT OF ENGLAND" contains "england", "IMPORTED FROM SCOTLAND"
    // contains "scotland"). Also handles the reverse for shorter extracted values.
    const containsMatch =
      extractedLower.includes(expectedLower) || expectedLower.includes(extractedLower);

    if (sim >= 0.75 || containsMatch) {
      return applyConfidenceGate(ocrConfidence, makeResult(
        "Country of Origin", "pass", extracted, expected, ocrConfidence,
        "Country of origin matches application data.", `"${extracted}"`
      ));
    } else {
      return makeResult("Country of Origin", "review", extracted, expected, ocrConfidence,
        "Country of origin may not match application data.",
        `Extracted: "${extracted}" | Expected: "${expected}"`);
    }
  }

  return applyConfidenceGate(ocrConfidence, makeResult(
    "Country of Origin", "pass", extracted, null, ocrConfidence,
    "Country of origin detected for imported product.", extracted
  ));
}

// Prohibited Claims Check
function validateProhibitedClaims(
  parsed: ParsedFields,
  ocrConfidence: number,
  usedAi: boolean
): FieldValidationResult {
  const detected = parsed.prohibitedClaims;

  // A valid claims string MUST contain at least one [CATEGORY|FAIL] or [CATEGORY|REVIEW] marker.
  // GPT sometimes returns "None", "No prohibited claims detected.", "" or "null" instead of null —
  // none of those are valid claim strings and must all be treated as "no claims found".
  const CLAIM_MARKER = /\[.+?\|(FAIL|REVIEW)\]/i;
  const hasDetectedClaims =
    typeof detected === "string" && detected.trim() !== "" &&
    detected.toLowerCase() !== "null" && CLAIM_MARKER.test(detected);

  if (!hasDetectedClaims) {
    // Pass unconditionally when no claims are detected. Prohibited claims can only be
    // evaluated by AI — OCR cannot read marketing language and should not flag this field.
    return makeResult(
      "Prohibited Claims", "pass", null, null, ocrConfidence,
      usedAi
        ? "No prohibited or potentially prohibited claims detected on this label."
        : "No prohibited claims detected."
    );
  }

  // FAIL-level claims are clear, unambiguous TTB violations (health claims, excessive drinking,
  // false geographic, organic without certification, obscene). REVIEW-level claims are
  // ambiguous and require human judgment (unsubstantiated superlatives, misleading nutrients).
  const hasFail = detected.includes("|FAIL]");
  if (hasFail) {
    return makeResult(
      "Prohibited Claims", "fail", detected, null, ocrConfidence,
      "One or more prohibited claims found that are direct TTB violations. Label must be rejected.",
      detected
    );
  }
  return makeResult(
    "Prohibited Claims", "review", detected, null, ocrConfidence,
    "One or more potentially prohibited claims detected. Manual TTB review required.",
    detected
  );
}

// Scans rawText for panel-separator markers and checks whether different panels
// report different alcohol percentages — a hard TTB compliance failure.
function detectCrossPanelAbvConflict(rawText: string): { conflict: boolean; details: string } {
  if (!rawText) return { conflict: false, details: "" };
  const sections = rawText.split(/---\s*\[Panel\s*\d+\]\s*---/i);
  if (sections.length < 2) return { conflict: false, details: "" };
  const abvRegex = /(\d{1,3}(?:\.\d{1,2})?)\s*%\s*(?:alc|alcohol|abv)/i;
  const panelAbvs: { panel: number; value: number; raw: string }[] = [];
  sections.forEach((section, idx) => {
    const match = section.match(abvRegex);
    if (match) {
      panelAbvs.push({ panel: idx + 1, value: parseFloat(match[1]), raw: match[0].trim() });
    }
  });
  if (panelAbvs.length < 2) return { conflict: false, details: "" };
  for (let i = 1; i < panelAbvs.length; i++) {
    if (Math.abs(panelAbvs[i].value - panelAbvs[0].value) > 0.5) {
      return {
        conflict: true,
        details: `Panel ${panelAbvs[0].panel} states "${panelAbvs[0].raw}" but Panel ${panelAbvs[i].panel} states "${panelAbvs[i].raw}"`,
      };
    }
  }
  return { conflict: false, details: "" };
}

// 7.7 Field of Vision Validation
export function validateFieldOfVision(
  parsed: ParsedFields,
  ocrConfidence: number
): FieldValidationResult {
  const hasBrand = !!parsed.brandName;
  const hasClass = !!parsed.classType;
  const hasAlcohol = !!parsed.alcoholContent;
  const hasWarning = !!parsed.governmentWarning;

  // Cross-panel ABV inconsistency — if two panels state different alcohol percentages
  // the label cannot be compliant regardless of what else is present.
  const abvConflict = detectCrossPanelAbvConflict(parsed.rawText);
  if (abvConflict.conflict) {
    return makeResult(
      "Field of Vision", "fail", null, null, ocrConfidence,
      "Alcohol content is inconsistent across panels — this is a TTB compliance failure.",
      abvConflict.details
    );
  }

  // A missing government warning is a hard fail — a label without this required
  // element cannot satisfy overall field-of-vision compliance regardless of what
  // else is present.
  if (!hasWarning) {
    return makeResult(
      "Field of Vision", "fail", null, null, ocrConfidence,
      "Field-of-vision compliance not met: government warning is absent from the label.",
      "All required label elements — including the government warning — must be present."
    );
  }

  if (!hasBrand || !hasClass || !hasAlcohol) {
    const missing = [
      !hasBrand && "brand name",
      !hasClass && "class/type",
      !hasAlcohol && "alcohol content",
    ]
      .filter(Boolean)
      .join(", ");
    return makeResult("Field of Vision", "review", null, null, ocrConfidence,
      `Cannot fully verify field-of-vision compliance — ${missing} not detected.`,
      "TTB requires brand name, class/type, and alcohol content to appear in the same field of vision.");
  }

  // OCR-based positional analysis is approximate — flag as review if confidence is low
  if (ocrConfidence < 70) {
    return makeResult("Field of Vision", "review", null, null, ocrConfidence,
      "OCR confidence too low for reliable field-of-vision spatial analysis. Manual review recommended.");
  }

  return makeResult("Field of Vision", "pass", null, null, ocrConfidence,
    "All required elements (brand, class/type, alcohol content, government warning) detected — field-of-vision compliance likely met.",
    "Note: Precise spatial placement requires physical label inspection for full compliance confirmation.");
}

export function computeOverallStatus(results: ValidationResults): "pass" | "fail" | "review" {
  const values = Object.values(results);
  if (values.some((r) => r.status === "fail")) return "fail";
  // Detected prohibited claims always escalate to review — regardless of all other fields
  // passing — because we have no documentation to substantiate any claim on the label.
  if (results.prohibitedClaims.status === "review") return "review";
  if (values.some((r) => r.status === "review")) return "review";
  return "pass";
}
