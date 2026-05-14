/**
 * Application Data File Parser
 *
 * Parses uploaded application data files (CSV, Excel, JSON, PDF)
 * into one or more ApplicationData records.
 *
 * Supports flexible column name variations so real-world exports
 * (e.g. COLAs Online, internal spreadsheets) map automatically.
 */

import Papa from "papaparse";
import * as XLSX from "xlsx";
import { ApplicationData } from "./types";

export interface ParsedApplicationRecord extends ApplicationData {
  /** Original filename this record should match to, if specified in the file */
  labelFileName?: string;
  /** Row number in the source file for error reporting */
  rowIndex?: number;
}

export interface AppDataParseResult {
  records: ParsedApplicationRecord[];
  warnings: string[];
  format: "csv" | "excel" | "json" | "pdf" | "text";
}

// ─── Column name aliases ────────────────────────────────────────────────────
// Maps every reasonable variation of a column heading to our internal field name.

const FIELD_ALIASES: Record<keyof ApplicationData | "labelFileName", string[]> = {
  labelFileName: ["file", "filename", "label file", "label_file", "image", "image file", "label image"],
  brandName: ["brand", "brand name", "brand_name", "brandname", "trade name", "trade_name", "product name", "product_name"],
  classType: ["class", "type", "class type", "class_type", "classtype", "designation", "spirit type", "spirit_type", "beverage class", "category"],
  alcoholContent: ["alcohol", "abv", "alcohol content", "alcohol_content", "alc by vol", "alc. by vol", "alcohol by volume", "proof", "alcohol %", "alc%"],
  netContents: ["net contents", "net_contents", "netcontents", "size", "volume", "bottle size", "container size", "net volume", "quantity"],
  bottlerName: ["bottler", "bottler name", "bottler_name", "company", "company name", "distillery", "producer", "importer", "responsible party"],
  bottlerCity: ["city", "bottler city", "bottler_city", "location city", "plant city"],
  bottlerState: ["state", "bottler state", "bottler_state", "location state", "plant state", "st"],
  bottlerAddress: ["bottler address", "bottler_address", "address", "full address", "bottler full address", "bottler location", "bottler_location", "location", "plant location", "facility location"],
  isImported: ["imported", "is imported", "is_imported", "import", "foreign", "domestic", "imported product", "imported_product", "is domestic", "domestic product"],
  countryOfOrigin: ["country", "country of origin", "country_of_origin", "origin", "origin country", "made in", "product of"],
};

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9 _]/g, "").replace(/\s+/g, " ");
}

/**
 * Normalize a brand name for fuzzy matching against folder names.
 * Strips common industry suffixes so "Bella Vista Vineyards" → "bellavista".
 */
function normalizeBrandForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(
      /\b(vineyards?|winery|wineries|distillery|distilleries|brewing|brewery|brewhouse|spirits?|cellars?|estates?|wines?|company|co\.?|inc\.?|llc\.?|ltd\.?)\b/g,
      ""
    )
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Normalize a submission label (folder name) for matching against brand names.
 * Strips "label(s)", status words (pass/fail/review), and industry suffixes so
 * e.g. "vistaLunaLabelPass" → "vistaluna" and "bellaVistaLabel" → "bellavista".
 */
function normalizeSubmissionLabelForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(labels?|pass|fail|review|passing|failing|approved|rejected)\b/g, "")
    .replace(
      /\b(vineyards?|winery|wineries|distillery|distilleries|brewing|brewery|brewhouse|spirits?|cellars?|estates?|wines?|company|co\.?|inc\.?|llc\.?|ltd\.?)\b/g,
      ""
    )
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// Keyword fallback: if exact alias matching fails, check whether the normalized
// header *contains* a defining keyword.  Ordered most-specific → least-specific
// to avoid mis-mapping (e.g. "bottler name" must resolve to bottlerName, not brandName).
const FIELD_KEYWORDS: Array<[keyof ApplicationData | "labelFileName", string[]]> = [
  ["isImported",      ["import"]],
  ["alcoholContent",  ["alcohol", "abv", "proof"]],
  ["countryOfOrigin", ["country", "origin"]],
  ["bottlerAddress",  ["bottler location", "plant location", "facility location"]],
  ["bottlerCity",     ["bottler city", "plant city", "city"]],
  ["bottlerState",    ["bottler state", "plant state", "state"]],
  ["bottlerName",     ["bottler", "distillery", "brewery", "winery", "producer", "importer", "responsible party"]],
  ["netContents",     ["net content", "net volume", "bottle size", "container size", "net quantity"]],
  ["classType",       ["class", "designation", "varietal", "spirit type", "product type", "beverage type"]],
  ["brandName",       ["brand", "trade name", "product name"]],
  ["labelFileName",   ["filename", "file name", "label file", "image file", "label image"]],
];

function resolveColumn(header: string): keyof ApplicationData | "labelFileName" | null {
  const norm = normalizeKey(header);

  // 1. Exact alias match
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((a) => normalizeKey(a) === norm)) {
      return field as keyof ApplicationData | "labelFileName";
    }
  }

  // 2. Keyword / substring fallback
  for (const [field, keywords] of FIELD_KEYWORDS) {
    if (keywords.some((kw) => norm.includes(normalizeKey(kw)))) {
      return field;
    }
  }

  return null;
}

function parseBool(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  const s = String(val).toLowerCase().trim();
  return ["true", "yes", "y", "1", "imported", "x"].includes(s);
}

function rowToRecord(
  row: Record<string, unknown>,
  headers: string[],
  rowIndex: number,
  warnings: string[]
): ParsedApplicationRecord {
  const record: ParsedApplicationRecord = {
    brandName: "",
    classType: "",
    alcoholContent: "",
    netContents: "",
    bottlerName: "",
    bottlerCity: "",
    bottlerState: "",
    isImported: false,
    countryOfOrigin: "",
    rowIndex,
  };

  for (const header of headers) {
    const field = resolveColumn(header);
    if (!field) continue;
    const val = row[header];
    if (val === undefined || val === null || val === "") continue;

    if (field === "isImported") {
      record.isImported = parseBool(val);
    } else {
      (record as unknown as Record<string, unknown>)[field] = String(val).trim();
    }
  }

  // If a combined "Bottler Location" / address was captured but city/state are still empty,
  // try to split "City, State" (e.g. "Napa, California" or "Lawrenceburg, KY") automatically.
  const combinedAddress = (record as unknown as Record<string, unknown>).bottlerAddress as string | undefined;
  if (combinedAddress && (!record.bottlerCity || !record.bottlerState)) {
    const parts = combinedAddress.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      if (!record.bottlerCity) record.bottlerCity = parts[0];
      if (!record.bottlerState) record.bottlerState = parts.slice(1).join(", ");
    } else if (parts.length === 1 && !record.bottlerCity) {
      record.bottlerCity = parts[0];
    }
  }

  // Basic completeness check
  if (!record.brandName) {
    warnings.push(`Row ${rowIndex + 1}: Brand name column not found or empty.`);
  }

  return record;
}

// ─── CSV ───────────────────────────────────────────────────────────────────

function parseCSV(text: string): AppDataParseResult {
  const warnings: string[] = [];
  const result = Papa.parse<Record<string, unknown>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0) {
    result.errors.slice(0, 3).forEach((e) => warnings.push(`CSV parse warning: ${e.message}`));
  }

  const headers = result.meta.fields ?? [];
  const records = result.data.map((row, i) => rowToRecord(row, headers, i, warnings));

  return { records, warnings, format: "csv" };
}

// ─── Excel ─────────────────────────────────────────────────────────────────

function parseExcel(buffer: ArrayBuffer): AppDataParseResult {
  const warnings: string[] = [];
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  if (rows.length === 0) {
    return { records: [], warnings: ["Excel file appears to be empty."], format: "excel" };
  }

  const headers = Object.keys(rows[0]);
  const records = rows.map((row, i) => rowToRecord(row, headers, i, warnings));
  return { records, warnings, format: "excel" };
}

// ─── JSON ──────────────────────────────────────────────────────────────────

function parseJSON(text: string): AppDataParseResult {
  const warnings: string[] = [];
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { records: [], warnings: ["Invalid JSON file."], format: "json" };
  }

  // Accept: array of objects, or single object, or { records: [...] }, or { data: [...] }
  let rows: unknown[] = [];
  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.records)) rows = obj.records;
    else if (Array.isArray(obj.data)) rows = obj.data;
    else if (Array.isArray(obj.labels)) rows = obj.labels;
    else rows = [parsed]; // single record
  }

  const records: ParsedApplicationRecord[] = rows.map((row, i) => {
    if (typeof row !== "object" || row === null) {
      warnings.push(`Row ${i + 1}: expected an object, got ${typeof row}`);
      return { brandName: "", classType: "", alcoholContent: "", netContents: "", bottlerName: "", bottlerCity: "", bottlerState: "", isImported: false, countryOfOrigin: "", rowIndex: i };
    }
    const headers = Object.keys(row as Record<string, unknown>);
    return rowToRecord(row as Record<string, unknown>, headers, i, warnings);
  });

  return { records, warnings, format: "json" };
}

// ─── PDF (text layer via pdf.js) ───────────────────────────────────────────

async function parsePDF(buffer: ArrayBuffer): Promise<AppDataParseResult> {
  const warnings: string[] = [];

  // Dynamically import pdfjs to avoid SSR issues
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  let text = "";
  try {
    const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + "\n";
    }
  } catch (err) {
    return {
      records: [],
      warnings: [`Could not read PDF text layer: ${err}. Try exporting as CSV or JSON instead.`],
      format: "pdf",
    };
  }

  // Try to extract structured fields from the raw PDF text using regex heuristics
  const record = extractFieldsFromText(text, warnings);
  return { records: [record], warnings, format: "pdf" };
}

function extractFieldsFromText(text: string, warnings: string[]): ParsedApplicationRecord {
  const get = (patterns: RegExp[]): string => {
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim();
    }
    return "";
  };

  const brandName = get([
    /brand\s*(?:name)?[:\s]+([^\n,]{2,50})/i,
    /trade\s*name[:\s]+([^\n,]{2,50})/i,
    /product\s*name[:\s]+([^\n,]{2,50})/i,
  ]);

  const classType = get([
    /class\s*(?:\/\s*type)?[:\s]+([^\n,]{2,40})/i,
    /type\s+of\s+(?:spirit|beverage|product)[:\s]+([^\n,]{2,40})/i,
    /designation[:\s]+([^\n,]{2,40})/i,
  ]);

  const alcoholContent = get([
    /alcohol\s+(?:content|by\s+volume)[:\s]+([\d.]+\s*%[^\n]{0,30})/i,
    /abv[:\s]+([\d.]+\s*%[^\n]{0,20})/i,
    /([\d.]+\s*%\s*alc[^\n]{0,20})/i,
  ]);

  const netContents = get([
    /net\s+contents?[:\s]+([\d.]+\s*(?:ml|l|liter)[^\n]{0,15})/i,
    /(?:bottle\s+)?size[:\s]+([\d.]+\s*(?:ml|l)[^\n]{0,15})/i,
    /([\d.]+\s*(?:ml|milliliter|liter|l\b)[^\n]{0,10})/i,
  ]);

  const bottlerName = get([
    /(?:bottled|distilled|produced|imported)\s+by[:\s]+([^\n,]{2,60})/i,
    /responsible\s+party[:\s]+([^\n,]{2,60})/i,
    /company\s*name[:\s]+([^\n,]{2,60})/i,
  ]);

  const bottlerCity = get([
    /city[:\s]+([^\n,]{2,40})/i,
    /location[:\s]+([^,\n]+),/i,
  ]);

  const bottlerState = get([
    /state[:\s]+([A-Z]{2})\b/i,
    /,\s*([A-Z]{2})\s*(?:\d{5})?(?:\n|$)/,
  ]);

  const importedText = get([/imported[:\s]+(yes|no|true|false|y|n)/i]);
  const isImported = parseBool(importedText || "false");

  const countryOfOrigin = get([
    /country\s+of\s+origin[:\s]+([^\n,]{2,40})/i,
    /(?:product|made)\s+of[:\s]+([^\n,]{2,40})/i,
  ]);

  if (!brandName) warnings.push("Could not auto-detect brand name from PDF. You may need to edit this field.");
  if (!alcoholContent) warnings.push("Could not auto-detect alcohol content from PDF.");

  return {
    brandName,
    classType,
    alcoholContent,
    netContents,
    bottlerName,
    bottlerCity,
    bottlerState,
    isImported,
    countryOfOrigin,
  };
}

// ─── Plain text fallback ────────────────────────────────────────────────────

function parseText(text: string): AppDataParseResult {
  const warnings: string[] = [];
  const record = extractFieldsFromText(text, warnings);
  if (!record.brandName && !record.alcoholContent) {
    warnings.push("Could not extract structured fields from plain text. Try a CSV or JSON export.");
  }
  return { records: [record], warnings, format: "text" };
}

// ─── Main entry point ───────────────────────────────────────────────────────

export async function parseApplicationDataFile(file: File): Promise<AppDataParseResult> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = file.type;

  if (ext === "json" || mime === "application/json") {
    const text = await file.text();
    return parseJSON(text);
  }

  if (ext === "csv" || mime === "text/csv") {
    const text = await file.text();
    return parseCSV(text);
  }

  if (ext === "xlsx" || ext === "xls" || mime.includes("spreadsheet") || mime.includes("excel")) {
    const buffer = await file.arrayBuffer();
    return parseExcel(buffer);
  }

  if (ext === "pdf" || mime === "application/pdf") {
    const buffer = await file.arrayBuffer();
    return parsePDF(buffer);
  }

  if (ext === "txt" || mime === "text/plain") {
    const text = await file.text();
    return parseText(text);
  }

  // Last resort: try reading as text
  const text = await file.text();
  if (text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
    return parseJSON(text);
  }
  if (text.includes(",") && text.split("\n").length > 1) {
    return parseCSV(text);
  }
  return parseText(text);
}

/**
 * Given a list of parsed records and a list of label submission names (folder names),
 * returns a record matched to each label.
 *
 * Matching priority:
 *   1. Explicit `filename` column in the manifest (exact key match)
 *   2. Brand name match — normalized brand name vs normalized folder name
 *      (strips industry suffixes from brand; strips "label" suffix from folder)
 *
 * Throws if any two records share the same normalized brand name, since the
 * match would be ambiguous.
 */
export function matchRecordsToLabels(
  records: ParsedApplicationRecord[],
  labelFileNames: string[]
): ApplicationData[] {
  if (records.length === 0) {
    return labelFileNames.map(() => emptyApplicationData());
  }

  if (records.length === 1) {
    return labelFileNames.map(() => ({ ...records[0] }));
  }

  // ── Duplicate brand name check ────────────────────────────────────────────
  const brandNormCounts = new Map<string, string[]>();
  for (const record of records) {
    const norm = normalizeBrandForMatch(record.brandName);
    if (!norm) continue;
    const existing = brandNormCounts.get(norm) ?? [];
    existing.push(record.brandName || "(blank)");
    brandNormCounts.set(norm, existing);
  }
  const duplicates = [...brandNormCounts.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([, names]) => names.join(" / "));
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate brand names in manifest — each brand must be unique. ` +
        `Duplicates found: ${duplicates.join("; ")}`
    );
  }

  // ── Build brand-name lookup index ─────────────────────────────────────────
  const brandIndex = new Map<string, ParsedApplicationRecord>();
  for (const record of records) {
    const norm = normalizeBrandForMatch(record.brandName);
    if (norm) brandIndex.set(norm, record);
  }

  return labelFileNames.map((labelName, i) => {
    // 1. Explicit filename column
    const byFileName = records.find(
      (r) => r.labelFileName && normalizeKey(r.labelFileName) === normalizeKey(labelName)
    );
    if (byFileName) return { ...byFileName };

    // 2. Brand name substring match against folder name
    const normLabel = normalizeSubmissionLabelForMatch(labelName);
    const byBrand = brandIndex.get(normLabel) ??
      // Also try substring: brand norm contained within the folder norm
      [...brandIndex.entries()].find(([brand]) => normLabel.includes(brand))?.[1];
    if (byBrand) return { ...byBrand };

    // 3. Positional fallback — Record 1 → Label 1, Record 2 → Label 2, etc.
    if (i < records.length) return { ...records[i] };

    return emptyApplicationData();
  });
}

function emptyApplicationData(): ApplicationData {
  return {
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
}
