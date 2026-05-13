/**
 * Client-safe panel filename utilities.
 *
 * These functions are pure string operations and contain no Node.js imports,
 * making them safe to use in both server and client components.
 */

/** Common panel position suffixes to strip before matching */
export const PANEL_SUFFIX_PATTERN =
  /[-_](front|back|rear|neck|cap|closure|side|left|right|top|bottom|label|panel|main|info|information|primary|secondary|aux|auxiliary)\d*$/i;

/**
 * Strip file extension, panel suffixes, and trailing panel numbers, then
 * normalize for application ID matching.
 *
 * Examples:
 *   "blackHollowLabel1.png"  → "blackhollowlabel"
 *   "PineRidgeLabel3.png"    → "pineridgelabel"
 *   "ttblabel7_back.png"     → "ttblabel7"  (digit is part of the ID, not a panel number,
 *                                             because "_back" suffix is stripped first)
 */
export function normalizeId(raw: string): string {
  return raw
    .replace(/\.[^/.]+$/, "")          // remove extension
    .replace(PANEL_SUFFIX_PATTERN, "")  // strip panel position suffix (e.g. _front, _back)
    .replace(/\d+$/, "")               // strip trailing panel counter digits (e.g. Label1 → Label)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");             // normalize spaces to dashes
}

/**
 * Returns a human-readable panel label from the filename suffix.
 * e.g. "ttblabel7_back.png" → "Back", "ttblabel7.png" → "Front"
 */
export function inferPanelLabel(filename: string): string {
  const withoutExt = filename.replace(/\.[^/.]+$/, "");
  const match = withoutExt.match(PANEL_SUFFIX_PATTERN);
  if (match) {
    const suffix = match[1];
    return suffix.charAt(0).toUpperCase() + suffix.slice(1).toLowerCase();
  }
  return "Front";
}
