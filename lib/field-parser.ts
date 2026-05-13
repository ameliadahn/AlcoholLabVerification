/**
 * Extracts structured fields from raw OCR text using regex patterns.
 * Designed for distilled spirits labels following TTB standards.
 */

export interface ParsedFields {
  brandName: string | null;
  classType: string | null;
  alcoholContent: string | null;
  netContents: string | null;
  bottlerStatement: string | null;
  governmentWarning: string | null;
  countryOfOrigin: string | null;
  rawText: string;
  /**
   * Prohibited or potentially prohibited claims detected by the AI.
   * Always null in the OCR fallback path — semantic detection requires AI.
   */
  prohibitedClaims: string | null;
}

const KNOWN_CLASS_TYPES = [
  "bourbon whiskey",
  "tennessee whiskey",
  "scotch whisky",
  "rye whiskey",
  "blended whiskey",
  "irish whiskey",
  "whiskey",
  "whisky",
  "vodka",
  "rum",
  "gin",
  "brandy",
  "cognac",
  "tequila",
  "mezcal",
  "liqueur",
  "cordial",
  "triple sec",
  "schnapps",
  "neutral spirits",
  "grain spirits",
  "distilled spirits",
  "american whiskey",
];

// Matches "40% Alc. by Vol.", "15.5% alcohol by volume", etc.
const ALCOHOL_CONTENT_REGEX =
  /(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:alc(?:ohol)?\.?(?:\s+by\s+vol(?:ume)?\.?)?|alcohol\s+by\s+volume)/i;

// Matches "750 mL", "1.75 L", "375ml", etc.
const NET_CONTENTS_REGEX = /(\d{1,4}(?:\.\d{1,2})?)\s*(ml|milliliter|millilitre|l\b|liter|litre)/i;

// Matches "Bottled by ..., City, ST" or "Distilled by ..." or "Imported by ..."
const BOTTLER_REGEX =
  /((?:bottled|distilled|produced|imported|packaged|rectified)\s+(?:by|in|at|and\s+bottled\s+by))\s+([^\n,]+(?:,\s*[^\n,]+)*)/i;

// Detects government warning sections (using [\s\S] instead of dotAll 's' flag for broader compat)
const GOV_WARNING_REGEX =
  /GOVERNMENT\s+WARNING\s*[:.]?\s*([\s\S]*?(?:\(1\)[\s\S]*?\(2\)[\s\S]*?(?:health problems|problems\.?)))/i;

const COUNTRY_ORIGIN_REGEX =
  /(?:product\s+of|made\s+in|imported\s+from|distilled\s+in|produced\s+in)\s+([A-Za-z\s]+?)(?:\.|,|\n|$)/i;

export function parseFields(ocrText: string): ParsedFields {
  const text = ocrText || "";
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  return {
    brandName: extractBrandName(text, lines),
    classType: extractClassType(text),
    alcoholContent: extractAlcoholContent(text),
    netContents: extractNetContents(text),
    bottlerStatement: extractBottlerStatement(text),
    governmentWarning: extractGovernmentWarning(text),
    countryOfOrigin: extractCountryOfOrigin(text),
    rawText: text,
    prohibitedClaims: null, // requires AI semantic analysis; regex cannot reliably detect
  };
}

function extractBrandName(text: string, lines: string[]): string | null {
  // Brand name is typically one of the first large-text items on a label
  // Heuristic: first non-trivial line that is NOT a class type, warning, or regulatory text
  const skipPatterns = [
    /government\s+warning/i,
    /^\d/,
    /bottled\s+by/i,
    /distilled\s+by/i,
    /imported\s+by/i,
    /alcohol\s+by\s+vol/i,
    /alc\.?\s*by\s*vol/i,
    /according\s+to/i,
    /surgeon\s+general/i,
    /consumption\s+of/i,
    /net\s+cont/i,
    /\bml\b|\bliter/i,
  ];

  const classTypePattern = new RegExp(KNOWN_CLASS_TYPES.join("|"), "i");

  for (const line of lines) {
    if (line.length < 2 || line.length > 60) continue;
    if (skipPatterns.some((p) => p.test(line))) continue;
    if (classTypePattern.test(line) && line.length < 25) continue;

    return line;
  }
  return null;
}

function extractClassType(text: string): string | null {
  const lower = text.toLowerCase();
  for (const ct of KNOWN_CLASS_TYPES) {
    if (lower.includes(ct)) {
      const idx = lower.indexOf(ct);
      return text.substring(idx, idx + ct.length);
    }
  }
  return null;
}

function extractAlcoholContent(text: string): string | null {
  const match = text.match(ALCOHOL_CONTENT_REGEX);
  if (match) {
    // Return the matched segment with surrounding context (up to ~25 chars)
    const start = Math.max(0, match.index!);
    const end = Math.min(text.length, start + match[0].length + 5);
    return text.substring(start, end).trim();
  }
  return null;
}

function extractNetContents(text: string): string | null {
  const match = text.match(NET_CONTENTS_REGEX);
  if (match) {
    return match[0].trim();
  }
  return null;
}

function extractBottlerStatement(text: string): string | null {
  const match = text.match(BOTTLER_REGEX);
  if (match) {
    return match[0].trim();
  }
  return null;
}

function extractGovernmentWarning(text: string): string | null {
  // Try to find the full government warning block
  const match = text.match(GOV_WARNING_REGEX);
  if (match) return match[0].trim();

  // Fallback: find if "GOVERNMENT WARNING" appears at all
  const gwIdx = text.toUpperCase().indexOf("GOVERNMENT WARNING");
  if (gwIdx !== -1) {
    return text.substring(gwIdx, Math.min(text.length, gwIdx + 400)).trim();
  }
  return null;
}

function extractCountryOfOrigin(text: string): string | null {
  const match = text.match(COUNTRY_ORIGIN_REGEX);
  if (match) return match[1].trim();
  return null;
}
