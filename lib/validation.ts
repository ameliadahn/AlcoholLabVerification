/**
 * TTB Compliance Validation Engine
 * Implements all 7 validation rules per PRD section 7.
 */

import { FieldValidationResult, ApplicationData, ValidationStatus } from "./types";
import { ParsedFields } from "./field-parser";

const REQUIRED_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

const ALCOHOL_CONTENT_VALID_REGEX =
  /\d{1,2}(?:\.\d{1,2})?\s*%\s*(?:alc(?:ohol)?\.?(?:\s+by\s+vol(?:ume)?\.?)?|alcohol\s+by\s+volume)/i;

const ABV_ONLY_REGEX = /\d+\s*(?:%\s*)?abv\b/i;
const NET_CONTENTS_VALID_REGEX = /\d{1,4}(?:\.\d{1,2})?\s*(?:ml|milliliter|millilitre|l\b|liter|litre)/i;
const BOTTLER_QUALIFIER_REGEX = /(?:bottled|distilled|produced|imported|packaged)\s+by/i;
const STATE_ABBR_REGEX = /\b[A-Z]{2}\b/;
const CITY_STATE_REGEX = /[A-Za-z\s]+,\s*[A-Z]{2}/;

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

export function validateLabel(
  parsed: ParsedFields,
  appData: ApplicationData,
  ocrConfidence: number
): ValidationResults {
  return {
    brandName: validateBrandName(parsed, appData, ocrConfidence),
    classType: validateClassType(parsed, appData, ocrConfidence),
    alcoholContent: validateAlcoholContent(parsed, appData, ocrConfidence),
    netContents: validateNetContents(parsed, appData, ocrConfidence),
    bottlerImporter: validateBottlerImporter(parsed, appData, ocrConfidence),
    governmentWarning: validateGovernmentWarning(parsed, ocrConfidence),
    countryOfOrigin: validateCountryOfOrigin(parsed, appData, ocrConfidence),
    prohibitedClaims: validateProhibitedClaims(parsed, ocrConfidence),
    fieldOfVision: validateFieldOfVision(parsed, ocrConfidence),
  };
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
  if (confidence < 85 && result.status === "pass") {
    return {
      ...result,
      status: "review",
      message: `Confidence ${confidence.toFixed(0)}% is below the reliable-read threshold. Manual review recommended.`,
    };
  }
  return result;
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

  const sim = similarity(extracted, expected);
  const extractedLower = extracted.toLowerCase();
  const expectedLower = expected.toLowerCase();
  // Pass when the label uses a more descriptive form that still contains the approved
  // designation (e.g. "PREMIUM VODKA" contains "vodka", "DISTILLED LONDON DRY GIN"
  // contains "london dry gin"). Also handles the reverse where the expected is broader.
  const containsMatch =
    extractedLower.includes(expectedLower) || expectedLower.includes(extractedLower);

  if (sim >= 0.75 || containsMatch) {
    return applyConfidenceGate(ocrConfidence, makeResult(
      "Class/Type", "pass", extracted, expected, ocrConfidence,
      "Class/type designation matches application data.", `"${extracted}"`
    ));
  } else {
    return makeResult("Class/Type", "review", extracted, expected, ocrConfidence,
      "Class/type designation may not match application data.",
      `Extracted: "${extracted}" | Expected: "${expected}"`);
  }
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
  const extracted = parsed.bottlerStatement;
  const expectedName = appData.bottlerName?.trim() ?? null;
  const expectedCity = appData.bottlerCity?.trim();
  const expectedState = appData.bottlerState?.trim();

  if (!extracted) {
    return makeResult("Bottler/Importer", "fail", null,
      expectedName ? `${expectedName}, ${expectedCity}, ${expectedState}` : (expectedCity ? `${expectedCity}, ${expectedState}` : null),
      ocrConfidence,
      'Missing bottler/importer statement. Must include qualifying phrase ("Bottled by", "Distilled by", "Imported by") followed by company name, city, and state.',
      'Example: "Bottled by Bright Distillery, Boston, MA"');
  }

  const hasQualifier = BOTTLER_QUALIFIER_REGEX.test(extracted);
  const hasCityState = CITY_STATE_REGEX.test(extracted);
  const hasStateAbbr = STATE_ABBR_REGEX.test(extracted);

  if (!hasQualifier) {
    return makeResult("Bottler/Importer", "fail", extracted, null, ocrConfidence,
      'Missing qualifying phrase. Must include "Bottled by", "Distilled by", or "Imported by".',
      `Detected text: "${extracted}"`);
  }

  if (!hasCityState && !hasStateAbbr) {
    return makeResult("Bottler/Importer", "fail", extracted, null, ocrConfidence,
      "Missing city and state abbreviation in bottler/importer statement.",
      `Detected: "${extracted}". Must include city and two-letter state abbreviation.`);
  }

  // Check against application data if provided
  if (expectedName) {
    const extractedLower = extracted.toLowerCase();
    const expectedLower = expectedName.toLowerCase();
    const exactMatch = extractedLower.includes(expectedLower) || expectedLower.includes(extractedLower);

    if (!exactMatch) {
      // Score by how many significant words from the expected name appear in the extracted text.
      // This is more reliable than string-level similarity because the extracted value is a full
      // statement ("Distilled and Bottled by X, City, ST") while the expected is just the company name.
      const significantWords = expectedLower.split(/\W+/).filter((w) => w.length > 3);
      const matchingWords = significantWords.filter((w) => extractedLower.includes(w));
      const wordOverlap = significantWords.length > 0 ? matchingWords.length / significantWords.length : 0;

      const expectedFull = `${expectedName}, ${expectedCity}, ${expectedState}`;

      if (wordOverlap >= 0.8) {
        // Nearly all key words match — likely a minor variation of the same company name
        return makeResult("Bottler/Importer", "review", extracted, expectedFull, ocrConfidence,
          "Bottler/importer name appears to be a variation of the application data. Confirm they are the same entity.",
          `Extracted: "${extracted}" | Expected: "${expectedName}"`);
      } else {
        // Company names do not match — this is a compliance failure
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
function validateGovernmentWarning(
  parsed: ParsedFields,
  ocrConfidence: number
): FieldValidationResult {
  const extracted = parsed.governmentWarning;

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

  // Check text similarity to required warning
  const sim = similarity(
    extracted.replace(/\s+/g, " ").trim(),
    REQUIRED_WARNING.replace(/\s+/g, " ").trim()
  );

  if (sim < 0.7) {
    // Low confidence OCR might cause this — flag for review rather than fail
    if (ocrConfidence < 85) {
      return makeResult("Government Warning", "review", extracted, REQUIRED_WARNING, ocrConfidence,
        "Warning text detected but OCR confidence is low. Manual review recommended.",
        `Text similarity to required warning: ${(sim * 100).toFixed(0)}%`);
    }
    return makeResult("Government Warning", "review", extracted, REQUIRED_WARNING, ocrConfidence,
      "Warning text detected but wording may differ from required statement.",
      `Text similarity: ${(sim * 100).toFixed(0)}%. Minor OCR errors may be the cause — manual review recommended.`);
  }

  return applyConfidenceGate(ocrConfidence, makeResult(
    "Government Warning", "pass", extracted, REQUIRED_WARNING, ocrConfidence,
    "Government warning statement detected with both required sections.",
    `Text similarity to required warning: ${(sim * 100).toFixed(0)}%`
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
  ocrConfidence: number
): FieldValidationResult {
  const detected = parsed.prohibitedClaims;

  // Treat empty string the same as null — the AI sometimes returns "" instead of null
  const hasDetectedClaims =
    typeof detected === "string" && detected.trim() !== "" && detected.toLowerCase() !== "null";

  if (!hasDetectedClaims) {
    // OCR fallback path always returns null — prohibited claim detection requires AI.
    if (ocrConfidence < 85) {
      return makeResult(
        "Prohibited Claims", "review", null, null, ocrConfidence,
        "Prohibited claim detection requires AI analysis. OCR fallback cannot evaluate marketing claims — manual review recommended.",
        "Run with AI (GPT-4o) enabled for automated prohibited claim screening."
      );
    }
    return makeResult(
      "Prohibited Claims", "pass", null, null, ocrConfidence,
      "No prohibited or potentially prohibited claims detected on this label."
    );
  }

  // Claims were detected — automatically flag for review. Per TTB policy, we have no
  // documentation to substantiate any marketing claim on the label, so every detected
  // claim requires manual TTB review regardless of how other fields evaluated.
  return makeResult(
    "Prohibited Claims", "review", detected, null, ocrConfidence,
    "One or more potentially prohibited claims detected. Manual TTB review required.",
    detected
  );
}

// 7.7 Field of Vision Validation
function validateFieldOfVision(
  parsed: ParsedFields,
  ocrConfidence: number
): FieldValidationResult {
  const hasBrand = !!parsed.brandName;
  const hasClass = !!parsed.classType;
  const hasAlcohol = !!parsed.alcoholContent;
  const hasWarning = !!parsed.governmentWarning;

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
  if (ocrConfidence < 85) {
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
