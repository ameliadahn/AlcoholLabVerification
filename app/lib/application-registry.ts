/**
 * Application Registry
 *
 * Loads application-data.json and provides lookup by filename ID.
 * The convention is: label filename (minus extension and panel suffix) must
 * match the "id" field in the JSON record.
 *
 * Panel suffixes are stripped automatically so that multi-panel submissions
 * like ttblabel7_front.png, ttblabel7_back.png all resolve to the same record.
 *
 * JSON record format:
 * {
 *   "id": "...",
 *   "expectedResult": "pass" | "fail" | "review",
 *   "reasonForResult": "...",
 *   "applicationData": { ...ApplicationData fields... }
 * }
 */

import "server-only";
import { ApplicationData } from "./types";
import { normalizeId, PANEL_SUFFIX_PATTERN } from "./panel-utils";
import fs from "fs";
import path from "path";

export interface ApplicationRecord {
  id: string;
  expectedResult: "pass" | "fail" | "review";
  reasonForResult: string;
  applicationData: ApplicationData;
}

export interface LookupResult {
  record: ApplicationRecord | null;
  /** Convenience accessor — the nested applicationData, or null if unmatched */
  applicationData: ApplicationData | null;
  matchedId: string | null;
  unmatched: boolean;
}

// Re-export so callers don't need to import panel-utils directly
export { normalizeId, PANEL_SUFFIX_PATTERN };

let cachedRegistry: ApplicationRecord[] | null = null;
let cachedFileMtimeMs: number | null = null;

export function loadRegistry(): ApplicationRecord[] {
  const filePath = path.join(process.cwd(), "public", "application-data.json");

  const fileMtimeMs = fs.statSync(filePath).mtimeMs;
  if (cachedRegistry && cachedFileMtimeMs === fileMtimeMs) {
    return cachedRegistry;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error("application-data.json must be an array of application records.");
  }

  cachedRegistry = data as ApplicationRecord[];
  cachedFileMtimeMs = fileMtimeMs;
  return cachedRegistry;
}

export function lookupByFilename(filename: string): LookupResult {
  const registry = loadRegistry();
  const needle = normalizeId(filename);

  const record = registry.find(
    (r) => normalizeId(r.id) === needle
  ) ?? null;

  return {
    record,
    applicationData: record?.applicationData ?? null,
    matchedId: needle,
    unmatched: record === null,
  };
}

/**
 * Look up a record by its exact ID (case-insensitive, space-to-dash normalized).
 */
export function lookupById(id: string): LookupResult {
  const registry = loadRegistry();
  const needle = id.trim().toLowerCase().replace(/\s+/g, "-");

  const record = registry.find(
    (r) => r.id.trim().toLowerCase().replace(/\s+/g, "-") === needle
  ) ?? null;

  return {
    record,
    applicationData: record?.applicationData ?? null,
    matchedId: needle,
    unmatched: record === null,
  };
}

/**
 * Given an array of filenames (all panels of one submission), determine the
 * most likely application record. Tries each filename and returns the first match.
 */
export function lookupByPanelFilenames(filenames: string[]): LookupResult {
  for (const name of filenames) {
    const result = lookupByFilename(name);
    if (!result.unmatched) return result;
  }
  return {
    record: null,
    applicationData: null,
    matchedId: filenames.length > 0 ? normalizeId(filenames[0]) : null,
    unmatched: true,
  };
}

export function getAllRecords(): ApplicationRecord[] {
  return loadRegistry();
}

export function clearRegistryCache(): void {
  cachedRegistry = null;
}
