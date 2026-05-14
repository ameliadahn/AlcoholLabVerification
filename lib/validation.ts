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
// Common non-English bottler/producer qualifier phrases (French, Italian, Spanish, German, Portuguese)
const FOREIGN_BOTTLER_QUALIFIER_REGEX =
  /\b(?:mis en bouteille|embouteill[eé] par|imbottigliato da|abgefüllt von?|embotellado por|engarrafado por|elaborado por|produit par|fabriqué par|mis en cave|récolté et mis en bouteille)\b/i;
// Foreign country names that indicate a non-US bottler address
const FOREIGN_COUNTRY_REGEX =
  /\b(?:france|italy|italia|spain|españa|germany|deutschland|scotland|ireland|england|united kingdom|uk|canada|mexico|japan|australia|new zealand|argentina|chile|portugal|austria|belgium|netherlands|denmark|sweden|switzerland|greece|hungary|czech republic|south africa|israel)\b/i;
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

/**
 * Set of individual tokens that are acceptable generic descriptors before/after a brand name.
 * These are stripped before comparing brand names so that "Granite Ridge Distilling Co."
 * and "Granite Ridge" are treated as the same brand.
 *
 * This list is the authoritative source — only words here are ignored during comparison.
 * Any other extra word is treated as a brand-name difference and will cause a fail.
 *
 * Multi-word phrases from the approved list (e.g. "Brew House", "Azienda Agricola") are
 * handled by tokenising: each individual token is added here so that when the name is
 * split on whitespace, every token in the phrase is dropped.
 */
const GENERIC_BRAND_WORDS = new Set([
  // Production / facility type
  "distillery", "distilleries", "distilling",
  "brewing", "brewery", "breweries", "brewhouse", "brew",
  "winery", "wineries",
  "vineyard", "vineyards",
  "vintners", "vintner",
  "cellars", "cellar",
  "cider",
  "meadery",
  "spirits",
  "beer",
  "whiskey", "whisky",
  "rum",
  "liquor",
  "beverage", "beverages",
  // Estate / property
  "estate", "estates",
  "reserve",
  "bottling", "bottlers",
  "productions", "production",
  "house",
  // Foreign estate/property words
  "maison",
  "domaine",
  "château", "chateau",
  "cantina",
  "bodegas", "bodega",
  "tenuta",
  "azienda",   // from "Azienda Agricola"
  "agricola",
  "società",   // from "Società Agricola"
  "societa",
  "société",
  "societe",
  // Import / trade
  "imports", "import", "importers",
  "trading",
  // Legal entity suffixes
  "llc", "inc", "incorporated", "ltd", "limited",
  "corp", "corporation", "plc", "lp", "llp",
  "company", "co",
  // Generic qualifiers that commonly wrap brand names
  "craft",
]);

/**
 * Returns only the meaningful name tokens after stripping generic industry/corporate words.
 * "GRANITE RIDGE DISTILLING CO." → ["granite", "ridge"]
 * "Pine Ridge Winery & Vineyards" → ["pine", "ridge"]
 */
function extractCoreNameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")   // normalise punctuation → spaces
    .split(/\s+/)
    .filter((w) => w.length > 0 && !GENERIC_BRAND_WORDS.has(w));
}

/**
 * Parses a net contents string into millilitres.
 * "750 mL" → 750, "1.75 L" → 1750, "1.75 liter" → 1750
 * Returns null if the string cannot be parsed.
 */
function parseNetContentsMl(s: string): number | null {
  const match = s.match(/(\d+(?:\.\d+)?)\s*(ml|milliliter|millilitre|l\b|liter|litre)/i);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  return unit === "ml" || unit.startsWith("milli") ? num : num * 1000;
}

/**
 * Returns true when `phrase` appears in `text` as a sequence of complete words
 * (word-boundary match, case-insensitive).
 *
 * Unlike String.includes(), this prevents substring false-positives:
 *   wholeWordContains("sauvignon blanconoco", "sauvignon blanc") → FALSE  ✓
 *   wholeWordContains("kentucky straight bourbon whiskey", "bourbon whiskey") → TRUE  ✓
 *   wholeWordContains("product of england", "england") → TRUE  ✓
 *   wholeWordContains("product of englandshire", "england") → FALSE  ✓
 */
function wholeWordContains(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, "i").test(text);
}

/**
 * Extracts the first US state abbreviation (two lowercase letters) from an already-normalised
 * text string (i.e. after normalizeStates() has run — full state names are already abbreviations).
 */
function extractStateAbbr(normalizedText: string): string | null {
  const stateSet = new Set(Object.values(STATE_NAME_TO_ABBR));
  const words = normalizedText.toLowerCase().split(/\W+/).filter((w) => w.length === 2);
  return words.find((w) => stateSet.has(w)) ?? null;
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

  // Strip every generic/corporate word from both sides using the approved list.
  // Whatever remains are the meaningful brand-identity tokens.
  // "GRANITE RIDGE DISTILLING CO."  → ["granite", "ridge"]
  // "Granite Ridge Vinyardary"       → ["granite", "ridge", "vinyardary"]  ← not on approved list
  // "Granite Ridge"                  → ["granite", "ridge"]
  //
  // The check is BIDIRECTIONAL:
  //   • Every expected core word must appear in the extracted core words  (label has the brand)
  //   • Every extracted core word must appear in the expected core words  (label has no extra unknown words)
  //
  // This means any word on the label that is NOT on the approved generic list AND is NOT in the
  // application data brand name is treated as a mismatch → hard fail.
  // Case and punctuation differences are already normalised away and are always acceptable.
  const extractedCoreWords = extractCoreNameWords(extracted);
  const expectedCoreWords  = extractCoreNameWords(expected);

  if (extractedCoreWords.length > 0 && expectedCoreWords.length > 0) {
    const expectedInExtracted = expectedCoreWords.every((w) => extractedCoreWords.includes(w));
    const extractedInExpected = extractedCoreWords.every((w) => expectedCoreWords.includes(w));

    if (expectedInExtracted && extractedInExpected) {
      return applyConfidenceGate(ocrConfidence, makeResult(
        "Brand Name", "pass", extracted, expected, ocrConfidence,
        "Brand name matches application data.",
        `Core words matched: [${extractedCoreWords.join(", ")}] = [${expectedCoreWords.join(", ")}]`
      ));
    }

    // Identify the specific words causing the mismatch for a clear error message.
    const unexpectedOnLabel = extractedCoreWords.filter((w) => !expectedCoreWords.includes(w));
    const missingFromLabel  = expectedCoreWords.filter((w) => !extractedCoreWords.includes(w));
    const detail = [
      unexpectedOnLabel.length > 0 ? `Extra word(s) on label not in application data: "${unexpectedOnLabel.join('", "')}"` : "",
      missingFromLabel.length  > 0 ? `Word(s) in application data missing from label: "${missingFromLabel.join('", "')}"` : "",
    ].filter(Boolean).join(" | ");

    return makeResult("Brand Name", "fail", extracted, expected, ocrConfidence,
      "Brand name does not match application data.",
      detail || `Extracted: "${extracted}" | Expected: "${expected}"`);
  }

  // Fallback when one or both sides reduce to nothing after stripping (edge case).
  return makeResult("Brand Name", "fail", extracted, expected, ocrConfidence,
    "Brand name does not match application data.",
    `Extracted: "${extracted}" | Expected: "${expected}"`);
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

  // If the expected value from the application isn't a recognizable designation at all,
  // treat it as a data-entry error and flag as a hard fail regardless of what's on the label.
  if (expectedGroup === null) {
    return makeResult("Class/Type", "fail", extracted, expected, ocrConfidence,
      `Application data specifies "${expected}" which is not a recognized TTB class/type designation. Verify application data before re-submitting.`,
      `"${expected}" is not a known spirit, wine, or beverage designation.`);
  }

  // If both types are identifiable but belong to different spirit groups, it is a hard fail.
  // (e.g. "Gin" on label vs "Vodka" in application — these are incompatible designations.)
  if (extractedGroup !== null && expectedGroup !== null && extractedGroup !== expectedGroup) {
    return makeResult("Class/Type", "fail", extracted, expected, ocrConfidence,
      "Class/type designation does not match application data. The spirit types are incompatible.",
      `Label shows "${extracted}" but application specifies "${expected}"`);
  }

  // Word-boundary containment: one designation must be fully contained within the other
  // as complete words. Handles "PREMIUM VODKA" vs "Vodka", "Kentucky Straight Bourbon Whiskey"
  // vs "Bourbon Whiskey", "London Dry Gin" vs "Gin" — while rejecting "Sauvignon Blanconoco"
  // vs "Sauvignon Blanc" (extra characters appended to a word ≠ acceptable variation).
  const containsMatch =
    wholeWordContains(extracted, expected) || wholeWordContains(expected, extracted);

  if (containsMatch) {
    return applyConfidenceGate(ocrConfidence, makeResult(
      "Class/Type", "pass", extracted, expected, ocrConfidence,
      "Class/type designation matches application data.", `"${extracted}"`
    ));
  }

  // Similarity-based fallback for cases where neither contains the other as whole words.
  // Only near-identical strings (≥0.90) are accepted — e.g. punctuation-only differences.
  // Anything below that threshold is a hard fail: class/type must match precisely.
  // A "review" tier is intentionally omitted because a non-matching designation cannot be
  // partially correct — either the label shows the right designation or it does not.
  const sim = similarity(extracted, expected);
  if (sim >= 0.90) {
    return applyConfidenceGate(ocrConfidence, makeResult(
      "Class/Type", "pass", extracted, expected, ocrConfidence,
      "Class/type designation matches application data.", `"${extracted}"`
    ));
  }
  return makeResult("Class/Type", "fail", extracted, expected, ocrConfidence,
    "Class/type designation does not match application data.",
    `Extracted: "${extracted}" | Expected: "${expected}" | Similarity: ${(sim * 100).toFixed(0)}%`);
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
    // Zero tolerance: alcohol percentage must exactly match the application.
    // 0.01 epsilon absorbs floating-point rounding only; any real difference is a hard fail.
    if (extractedNum && expectedNum && Math.abs(parseFloat(extractedNum) - parseFloat(expectedNum)) > 0.01) {
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
    const extractedMl = parseNetContentsMl(extracted);
    const expectedMl  = parseNetContentsMl(expected);

    if (extractedMl !== null && expectedMl !== null) {
      // Zero tolerance: the numeric volume on the label must exactly match the application.
      // A 0.01 mL epsilon is used only to absorb floating-point rounding (e.g. 750.0 vs 750.0000001);
      // any real difference — even 1 mL — is a hard fail.
      if (Math.abs(extractedMl - expectedMl) > 0.01) {
        return makeResult("Net Contents", "fail", extracted, expected, ocrConfidence,
          "Net contents do not match application data.",
          `Label states ${extractedMl % 1 === 0 ? extractedMl : extractedMl.toFixed(1)} mL but application specifies ${expectedMl % 1 === 0 ? expectedMl : expectedMl.toFixed(1)} mL`);
      }
    } else {
      // Fallback string comparison when unit parsing fails — tightened threshold, fails not reviews.
      const sim = similarity(extracted.replace(/\s/g, ""), expected.replace(/\s/g, ""));
      if (sim < 0.85) {
        return makeResult("Net Contents", "fail", extracted, expected, ocrConfidence,
          "Net contents do not match application data.",
          `Extracted: "${extracted}" | Expected: "${expected}"`);
      }
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

  // Build a single canonical expected string for both comparison and display.
  // When bottlerAddress is provided (e.g. "Deerfield, IL" from a CSV) but doesn't
  // already contain the company name, prepend it so validation checks the full statement.
  const fullExpected: string | null = (() => {
    const addr = appData.bottlerAddress?.trim() ?? null;
    if (addr) {
      if (expectedName && !addr.toLowerCase().includes(expectedName.toLowerCase())) {
        return `${expectedName}, ${addr}`;
      }
      return addr;
    }
    const parts = [expectedName, expectedCity, expectedState].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  })();

  // extracted is now just company name + address (qualifier stripped at extraction time).
  // Defensively strip any residual qualifier prefix in case old data or model non-compliance.
  const rawExtracted = parsed.bottlerStatement;
  const extracted = rawExtracted
    ? rawExtracted.replace(BOTTLER_QUALIFIER_REGEX, "").replace(/^[\s|,–—]+/, "").trim() || rawExtracted
    : null;

  if (!extracted) {
    return makeResult("Bottler/Importer", "fail", null, fullExpected,
      ocrConfidence,
      'Missing bottler/importer statement. Must include qualifying phrase ("Bottled by", "Distilled by", "Imported by") followed by company name, city, and state.',
      'Example: "Bottled by Bright Distillery, Boston, MA"');
  }

  // Qualifier presence is checked in rawText (where the full label text lives) since
  // the extracted value no longer includes the qualifying phrase itself.
  const hasEnglishQualifier = BOTTLER_QUALIFIER_REGEX.test(parsed.rawText ?? "");
  const hasForeignQualifier = FOREIGN_BOTTLER_QUALIFIER_REGEX.test(parsed.rawText ?? "");
  const hasCityState = CITY_STATE_REGEX.test(extracted);
  const hasStateAbbr = STATE_ABBR_REGEX.test(extracted);
  const hasForeignAddress = FOREIGN_COUNTRY_REGEX.test(extracted);

  // Non-English bottler statement — foreign-language qualifier with no English equivalent.
  // TTB requires all mandatory label information to be in English (27 CFR §4.38(a)).
  if (!hasEnglishQualifier && hasForeignQualifier) {
    return makeResult("Bottler/Importer", "fail", extracted, fullExpected, ocrConfidence,
      "Bottler/producer statement is in a non-English language. TTB requires all mandatory label information to be in English (27 CFR §4.38(a)).",
      `Foreign-language qualifier detected on label. An English-language "Bottled by", "Distilled by", or "Imported by" statement is required.`);
  }

  if (!hasEnglishQualifier) {
    return makeResult("Bottler/Importer", "fail", extracted, fullExpected, ocrConfidence,
      'Missing qualifying phrase on label. Must include "Bottled by", "Distilled by", or "Imported by".',
      `Detected company text: "${extracted}"`);
  }

  // Bottler shows a foreign address — for imported products this means the original producer
  // was extracted instead of a US importer statement. A US "Imported by" statement is required.
  if (hasForeignAddress && !hasCityState && !hasStateAbbr) {
    return makeResult("Bottler/Importer", "fail", extracted, fullExpected, ocrConfidence,
      "Bottler statement shows a foreign address. For imported products a separate English-language \"Imported by [US importer name, city, state]\" statement is required on the label.",
      `Detected foreign address: "${extracted}". A US importer statement with city and state is required.`);
  }

  if (!hasCityState && !hasStateAbbr) {
    return makeResult("Bottler/Importer", "fail", extracted, fullExpected, ocrConfidence,
      "Missing city and state abbreviation in bottler/importer statement.",
      `Detected: "${extracted}". Must include city and two-letter state abbreviation.`);
  }

  // Check against fullExpected (name + address merged) when any application data is provided.
  if (fullExpected) {
    // Normalise state names (e.g. "OREGON" → "or") before comparison so that full
    // state names and two-letter abbreviations are treated as identical.
    const extractedNorm = normalizeStates(extracted);
    const expectedNorm  = normalizeStates(fullExpected);

    // Hard fail on explicit state mismatch — "KY" on label vs "IL" in application is never acceptable.
    const extractedState = extractStateAbbr(extractedNorm);
    const expectedState  = extractStateAbbr(expectedNorm);
    if (extractedState && expectedState && extractedState !== expectedState) {
      return makeResult("Bottler/Importer", "fail", extracted, fullExpected, ocrConfidence,
        "Bottler/importer state does not match application data.",
        `Label shows "${extractedState.toUpperCase()}" but application specifies "${expectedState.toUpperCase()}"`);
    }

    const extractedTokens  = extractedNorm.split(/\W+/).filter((w) => w.length > 3);
    const significantWords = expectedNorm.split(/\W+/).filter((w) => w.length > 3);

    // A significant word "matches" if the extracted text contains an exact token or
    // a token within Levenshtein distance 1–2 (handles single-character OCR typos).
    const matchingWords = significantWords.filter((exp) =>
      extractedTokens.some((got) => wordsMatch(got, exp))
    );
    const wordOverlap = significantWords.length > 0 ? matchingWords.length / significantWords.length : 0;

    if (wordOverlap < 0.6) {
      return makeResult("Bottler/Importer", "fail", extracted, fullExpected, ocrConfidence,
        "Bottler/importer information on label does not match application data.",
        `Extracted: "${extracted}" | Expected: "${fullExpected}"`);
    }
    if (wordOverlap < 0.9) {
      return makeResult("Bottler/Importer", "review", extracted, fullExpected, ocrConfidence,
        "Bottler/importer information may not fully match application data. Manual review recommended.",
        `Extracted: "${extracted}" | Expected: "${fullExpected}"`);
    }
    return applyConfidenceGate(ocrConfidence, makeResult(
      "Bottler/Importer", "pass", extracted, fullExpected, ocrConfidence,
      "Bottler/importer statement matches application data.", extracted
    ));
  }

  return applyConfidenceGate(ocrConfidence, makeResult(
    "Bottler/Importer", "pass", extracted, fullExpected,
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
  const normExtracted = normalize(extracted);
  const normRequired = normalize(REQUIRED_WARNING);

  // Compare both the full extracted text AND a prefix-truncated version.
  // Labels often have additional text immediately after "health problems." (allergen
  // statements, bottler address, barcodes). This extra content is not the bottler's
  // fault — the required warning IS complete. Using the better of the two scores
  // ensures trailing non-warning text does not cause a false fail.
  const prefixSim = similarity(normExtracted.substring(0, normRequired.length), normRequired);
  const fullSim = similarity(normExtracted, normRequired);
  const sim = Math.max(prefixSim, fullSim);

  // AI path (governmentWarningLegible === true): require 95% — AI self-checked every word.
  // OCR path (governmentWarningLegible === undefined): 85% threshold — Tesseract can introduce
  // single-character substitutions, extra hyphens, or split words that legitimately
  // lower similarity without the underlying text being wrong.
  const simThreshold = parsed.governmentWarningLegible === true ? 0.95 : 0.85;
  if (sim < simThreshold) {
    return makeResult("Government Warning", "fail", extracted, REQUIRED_WARNING, ocrConfidence,
      "Government warning text does not match the required statement. The warning words must match — minor spacing or capitalization differences in the body are acceptable but missing or changed words are not.",
      `Word-level similarity: ${(sim * 100).toFixed(0)}% (after normalizing case and spacing). Required: ≥${Math.round(simThreshold * 100)}%.`);
  }

  // The similarity check above IS the verification gate for both paths.
  // A ≥85% (OCR) or ≥95% (AI) text match proves the warning was actually read —
  // the image confidence score must not override a confirmed text match.
  // (For hallucination defence: if Claude made up the text, it would not match the
  // required wording at ≥95% unless it guessed every word — which the anti-hallucination
  // instructions in Section A already prevent by instructing null when unsure.)
  const source = parsed.governmentWarningLegible === true
    ? "AI vision"
    : parsed.governmentWarningLegible === undefined
      ? "OCR"
      : "AI vision (fallback)";
  return makeResult(
    "Government Warning", "pass", extracted, REQUIRED_WARNING, ocrConfidence,
    "Government warning statement verified — text matches required wording.",
    `Verified by ${source}. Word-level similarity: ${(sim * 100).toFixed(0)}%`
  );
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
    // Use word-boundary containment so that "PRODUCT OF FRANCE" correctly matches "France"
    // while "PRODUCT OF FRANCONIA" does not — extra characters appended to the country
    // name are not acceptable.
    const containsMatch =
      wholeWordContains(extracted, expected) || wholeWordContains(expected, extracted);

    if (containsMatch) {
      return applyConfidenceGate(ocrConfidence, makeResult(
        "Country of Origin", "pass", extracted, expected, ocrConfidence,
        "Country of origin matches application data.", `"${extracted}"`
      ));
    }

    const sim = similarity(extracted, expected);
    if (sim >= 0.85) {
      return applyConfidenceGate(ocrConfidence, makeResult(
        "Country of Origin", "pass", extracted, expected, ocrConfidence,
        "Country of origin matches application data.", `"${extracted}"`
      ));
    }
    if (sim >= 0.65) {
      return makeResult("Country of Origin", "review", extracted, expected, ocrConfidence,
        "Country of origin is similar to but does not exactly match application data. Manual review recommended.",
        `Extracted: "${extracted}" | Expected: "${expected}" | Similarity: ${(sim * 100).toFixed(0)}%`);
    }
    return makeResult("Country of Origin", "fail", extracted, expected, ocrConfidence,
      "Country of origin does not match application data.",
      `Extracted: "${extracted}" | Expected: "${expected}"`);
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
