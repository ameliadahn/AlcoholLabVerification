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
  /**
   * AI legibility attestation for the government warning.
   * true  — AI confirmed it read every word from the image pixels.
   * false — AI attested the warning was absent, blurry, garbled, or otherwise unreadable.
   * undefined — OCR fallback path; no legibility attestation available.
   */
  governmentWarningLegible?: boolean;
  countryOfOrigin: string | null;
  rawText: string;
  /**
   * Prohibited or potentially prohibited claims detected by the AI.
   * Always null in the OCR fallback path — semantic detection requires AI.
   */
  prohibitedClaims: string | null;
}

const KNOWN_CLASS_TYPES = [
  // Whiskey / Whisky
  "straight bourbon whiskey",
  "kentucky straight bourbon whiskey",
  "tennessee whiskey",
  "tennessee straight whiskey",
  "scotch whisky",
  "blended scotch whisky",
  "single malt scotch whisky",
  "rye whiskey",
  "straight rye whiskey",
  "blended whiskey",
  "irish whiskey",
  "american whiskey",
  "bourbon whiskey",
  "whiskey",
  "whisky",
  // Base spirits
  "vodka",
  "rum",
  "gin",
  "london dry gin",
  "brandy",
  "cognac",
  "armagnac",
  "pisco",
  "tequila",
  "blanco tequila",
  "mezcal",
  // Liqueurs
  "liqueur",
  "cordial",
  "triple sec",
  "schnapps",
  "amaro",
  // Other spirits
  "neutral spirits",
  "grain spirits",
  "distilled spirits",
  // Wine
  "red wine",
  "white wine",
  "rosé wine",
  "rose wine",
  "sparkling wine",
  "dessert wine",
  "port wine",
  "sherry",
  "prosecco",
  "champagne",
  "bordeaux",
  "burgundy",
  "chardonnay",
  "cabernet sauvignon",
  "merlot",
  "pinot noir",
  "pinot grigio",
  "sauvignon blanc",
  "riesling",
  "malbec",
  "syrah",
  "shiraz",
  "zinfandel",
  "barolo",
  "chianti",
  "rioja",
  "toscana rosso",
  "toscana bianco",
  "toscana",
  "rosso",
  "bianco",
  "rouge",
  "blanc",
  "igt",
  "doc",
  "docg",
  "aoc",
  "wine",
  // Beer / Malt
  "beer",
  "lager",
  "ale",
  "india pale ale",
  "ipa",
  "stout",
  "porter",
  "wheat beer",
  "pilsner",
  "sour ale",
  "malt beverage",
  "hard seltzer",
  "hard cider",
  "cider",
  // Ready-to-drink
  "rum punch",
  "hard lemonade",
  "hard tea",
];

// Matches "40% Alc./Vol.", "40% Alc/Vol", "40% ABV", "ALC. 40% BY VOL.", "80 Proof", etc.
const ALCOHOL_CONTENT_REGEX =
  /(\d{1,3}(?:\.\d{1,2})?)\s*%\s*(?:alc(?:ohol)?\.?\s*(?:[/\\]\s*vol(?:ume)?\.?|\s+by\s+vol(?:ume)?\.?)?|alcohol\s+by\s+volume|abv)|alc(?:ohol)?\.?\s*(\d{1,3}(?:\.\d{1,2})?)\s*%\s*(?:by\s+)?vol(?:ume)?\.?/i;

// Matches "750 mL", "1.75 L", "375ml", etc.
const NET_CONTENTS_REGEX = /(\d{1,4}(?:\.\d{1,2})?)\s*(ml|milliliter|millilitre|l\b|liter|litre)/i;

// Matches single and compound qualifiers: "Bottled by", "Canned by", "Distilled and Bottled by", etc.
const BOTTLER_QUALIFIER =
  /(?:bottled|distilled|produced|imported|packaged|rectified|canned|brewed|manufactured)(?:\s+and\s+(?:bottled|distilled|produced|imported|packaged|rectified|canned|brewed|manufactured))?\s+by/i;
// Captures the qualifier and up to 2 lines following it (company name + city/state line).
// The (?:\n[^\n]+){0,1} allows the address to span onto the next line when OCR outputs
// "COMPANY NAME\nCITY, STATE" instead of "COMPANY NAME, CITY, STATE" on one line.
const BOTTLER_REGEX =
  new RegExp(`(${BOTTLER_QUALIFIER.source})\\s+([^\\n]+(?:\\n[^\\n]+){0,1})`, "i");

// Detects the government warning block starting at "GOVERNMENT WARNING" and running through
// the end of the second mandatory section. The end anchor accepts several OCR variants:
// "health problems", "HEALTH PROBLEMS.", "health prob-\nlems", or just a reasonable length
// of text if the exact closing phrase isn't legible. The regex is intentionally permissive
// so that OCR line-break artifacts and minor mis-reads don't cause the block to be lost.
const GOV_WARNING_REGEX =
  /GOVERNMENT\s+WARNING\s*[:.]?\s*[\s\S]{20,800}?(?:health\s+problems?\.?|\(2\)[\s\S]{5,300})/i;

const COUNTRY_ORIGIN_REGEX =
  /(?:product\s+of|made\s+in|imported\s+from|distilled\s+in|produced\s+in)\s+([A-Za-z\s]+?)(?:\.|,|\n|$)/i;

export function parseFields(ocrText: string): ParsedFields {
  // Strip all panel separator markers injected by the OCR orchestrator before any
  // field extraction runs.  Handles all observed variants:
  //   "--- [Panel 1: filename.png] ---"
  //   "--- [Panel 1] ---"
  //   "[Panel 1: filename.png]"
  const text = (ocrText || "")
    .replace(/(?:---\s*)?\[(?:Panel|Image)\s*\d+[^\]]*\](?:\s*---)?/gi, "")
    .replace(/\n{3,}/g, "\n\n")   // collapse any blank lines left behind
    .trim();
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
    // Panel / image separator markers (defensive — should already be stripped above)
    /^\[(?:Panel|Image)\s*\d+/i,
    /^-{2,}/,
    /\.png|\.jpg|\.jpeg|\.webp/i,
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
    // Return only the company name and address (group 2), not the qualifying phrase (group 1).
    // Strip leading OCR artifacts, then join multi-line segments with ", " so that
    // "GREENMEADOW DISTILLING CO.\nPORTLAND, OREGON" becomes
    // "GREENMEADOW DISTILLING CO., PORTLAND, OREGON".
    const content = (match[2] ?? "")
      .replace(/^[\s|,–—]+/, "")
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(", ");
    return content || null;
  }
  return null;
}

export function extractGovernmentWarning(text: string): string | null {
  // Normalise OCR whitespace artifacts: collapse any run of whitespace between
  // "GOVERNMENT" and "WARNING" to a single space so line-break splits don't
  // cause the header to be missed. Also collapse intra-word spaces that Tesseract
  // occasionally inserts (e.g. "GOVERN MENT").
  const normalised = text
    .replace(/GOVERN\s+MENT/gi, "GOVERNMENT")
    .replace(/WARN\s+ING/gi, "WARNING")
    .replace(/GOVERNMENT\s{2,}WARNING/gi, "GOVERNMENT WARNING");

  // Try the full-block regex on the normalised text first.
  const match = normalised.match(GOV_WARNING_REGEX);
  if (match) return match[0].trim();

  // Truncate at "health problems" — anything after this phrase is not part of
  // the required warning (e.g. "CONTAINS SULFITES", bottler address, barcodes).
  const truncateAtHealthProblems = (s: string, start: number): string => {
    const window = s.substring(start, Math.min(s.length, start + 600));
    const stopMatch = window.match(/health\s+problems\.?/i);
    const end = stopMatch && stopMatch.index !== undefined
      ? stopMatch.index + stopMatch[0].length
      : window.length;
    return window.substring(0, end).trim();
  };

  // Fallback 1: "GOVERNMENT WARNING" is present — grab up to "health problems."
  const gwIdx = normalised.toUpperCase().indexOf("GOVERNMENT WARNING");
  if (gwIdx !== -1) {
    return truncateAtHealthProblems(normalised, gwIdx);
  }

  // Fallback 2: OCR split the header across lines or garbled it beyond the fixes above.
  // Look for "GOVT WARNING", "GOV. WARNING", "GOVERNMENT WARN" etc.
  const fuzzyMatch = normalised.match(/GOV(?:ERN(?:MENT)?)?\.?\s+WARN(?:ING)?/i);
  if (fuzzyMatch && fuzzyMatch.index !== undefined) {
    return truncateAtHealthProblems(normalised, fuzzyMatch.index);
  }

  return null;
}

function extractCountryOfOrigin(text: string): string | null {
  const match = text.match(COUNTRY_ORIGIN_REGEX);
  if (match) return match[1].trim();
  return null;
}
