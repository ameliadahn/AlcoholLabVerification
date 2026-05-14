#!/usr/bin/env node
/**
 * Fine-tuning Script 2 — Build Training JSONL
 * ─────────────────────────────────────────────
 * Reads every extraction file in scripts/extractions/ where "correction" has
 * been filled in and assembles the OpenAI fine-tuning JSONL file.
 *
 * Each training example is one line of JSON containing:
 *   • system  — the full SYSTEM_PROMPT (identical to production)
 *   • user    — all panel images as base64 + the buildUserPrompt text
 *   • assistant — the corrected JSON output (the "ideal" response)
 *
 * The resulting file is written to scripts/training.jsonl.
 *
 * Usage:
 *   npm run finetune:build
 *   — or —
 *   node scripts/2-build-finetune-jsonl.mjs
 *
 * Flags:
 *   --validate   Run basic checks on the JSONL after writing (recommended)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ROOT } from "./lib/env.mjs";
import { SYSTEM_PROMPT, buildUserPrompt } from "./lib/prompts.mjs";

// ─── Config ──────────────────────────────────────────────────────────────────

const EXTRACTIONS_DIR = path.join(ROOT, "scripts", "extractions");
const OUTPUT_PATH = path.join(ROOT, "scripts", "training.jsonl");
const LABELS_BASE = path.join(ROOT, "public", "sampleLabels");

// OpenAI recommends at least 10 examples; 50+ gives much better results.
const MINIMUM_RECOMMENDED = 10;

const args = process.argv.slice(2);
const validateFlag = args.includes("--validate");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function imageToBase64(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
  const mimeType = mimeMap[ext] ?? "image/png";
  const base64 = fs.readFileSync(filePath).toString("base64");
  return { base64, mimeType };
}

/**
 * Given an extraction record, find the image files on disk.
 * Tries the stored submissionDir path first, then falls back to walking
 * the sampleLabels tree.
 */
function resolveImageDir(record) {
  // Try the path stored at generation time
  if (record.submissionDir) {
    const candidate = path.join(ROOT, record.submissionDir);
    if (fs.existsSync(candidate)) return candidate;
  }

  // Fall back: search sampleLabels recursively for a folder named labelId
  function findDir(base, name) {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(base, entry.name);
      if (entry.name === name) return full;
      const found = findDir(full, name);
      if (found) return found;
    }
    return null;
  }

  return findDir(LABELS_BASE, record.labelId);
}

/**
 * Validates the finished JSONL file for obvious structural problems.
 * Returns a list of warning strings (empty = all good).
 */
function validateJsonl(filePath) {
  const warnings = [];
  const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    let parsed;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      warnings.push(`Line ${lineNum}: invalid JSON`);
      continue;
    }

    if (!Array.isArray(parsed.messages)) {
      warnings.push(`Line ${lineNum}: missing "messages" array`);
      continue;
    }

    const roles = parsed.messages.map((m) => m.role);
    if (!roles.includes("system"))   warnings.push(`Line ${lineNum}: no system message`);
    if (!roles.includes("user"))     warnings.push(`Line ${lineNum}: no user message`);
    if (!roles.includes("assistant")) warnings.push(`Line ${lineNum}: no assistant message`);

    const assistant = parsed.messages.find((m) => m.role === "assistant");
    if (assistant) {
      try {
        JSON.parse(assistant.content);
      } catch {
        warnings.push(`Line ${lineNum}: assistant content is not valid JSON`);
      }
    }
  }

  return warnings;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(EXTRACTIONS_DIR)) {
    console.error(`scripts/extractions/ not found. Run script 1 first:\n  npm run finetune:generate`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(EXTRACTIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    console.error("No extraction files found in scripts/extractions/. Run script 1 first.");
    process.exit(1);
  }

  console.log(`\n📂 Found ${files.length} extraction file(s)\n`);

  const lines = [];
  let included = 0;
  let usedGptOutput = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const labelId = file.replace(/\.json$/, "");
    const extractionPath = path.join(EXTRACTIONS_DIR, file);
    let record;

    try {
      record = JSON.parse(fs.readFileSync(extractionPath, "utf-8"));
    } catch (err) {
      console.error(`  ❌ ${file}: failed to parse — ${err.message}`);
      errors++;
      continue;
    }

    // Determine which output to use as the "ideal" assistant response
    let idealOutput;
    if (record.correction === null || record.correction === undefined) {
      console.log(`  ⏭  ${labelId} — correction is null, skipping`);
      skipped++;
      continue;
    } else if (record.correction === "USE_GPT_OUTPUT") {
      idealOutput = record.gptOutput;
      usedGptOutput++;
      console.log(`  ✔  ${labelId} — using gptOutput as-is`);
    } else if (typeof record.correction === "object") {
      idealOutput = record.correction;
      console.log(`  ✏️  ${labelId} — using manual correction`);
    } else {
      console.warn(`  ⚠️  ${labelId} — unrecognised correction value, skipping`);
      skipped++;
      continue;
    }

    // Locate the image files on disk
    const imageDir = resolveImageDir(record);
    if (!imageDir) {
      console.error(`  ❌ ${labelId}: could not find image directory on disk`);
      errors++;
      continue;
    }

    // Build image content blocks
    let imageBlocks;
    try {
      imageBlocks = record.panelFiles.map((fileName) => {
        const filePath = path.join(imageDir, fileName);
        if (!fs.existsSync(filePath)) {
          throw new Error(`Panel image not found: ${filePath}`);
        }
        const { base64, mimeType } = imageToBase64(filePath);
        return {
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${base64}` },
        };
      });
    } catch (err) {
      console.error(`  ❌ ${labelId}: ${err.message}`);
      errors++;
      continue;
    }

    const userPromptText = buildUserPrompt(record.applicationData, record.panelFiles);

    const trainingExample = {
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: [
            ...imageBlocks,
            { type: "text", text: userPromptText },
          ],
        },
        {
          role: "assistant",
          // The assistant response must be a JSON string (not an object)
          content: JSON.stringify(idealOutput),
        },
      ],
    };

    lines.push(JSON.stringify(trainingExample));
    included++;
  }

  if (included === 0) {
    console.error(`
No training examples were built. Make sure at least one extraction file has
a non-null "correction" value or "USE_GPT_OUTPUT".
`);
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT_PATH, lines.join("\n") + "\n", "utf-8");

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅  Included  : ${included} training example${included !== 1 ? "s" : ""}
       (${usedGptOutput} used gptOutput, ${included - usedGptOutput} used manual corrections)
  ⏭  Skipped   : ${skipped}
  ❌  Errors    : ${errors}
  📄  Output    : scripts/training.jsonl
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (included < MINIMUM_RECOMMENDED) {
    console.warn(`
  ⚠️  WARNING: Only ${included} training example${included !== 1 ? "s" : ""} — OpenAI recommends at least
     ${MINIMUM_RECOMMENDED} (ideally 50+) for meaningful fine-tuning results.
     Consider adding more labelled examples before submitting.`);
  }

  // Optional validation pass
  if (validateFlag || included > 0) {
    console.log("\n  🔍 Validating JSONL…");
    const warnings = validateJsonl(OUTPUT_PATH);
    if (warnings.length === 0) {
      console.log("     All lines valid ✅");
    } else {
      console.warn(`     ${warnings.length} issue(s) found:`);
      for (const w of warnings) console.warn(`       • ${w}`);
    }
  }

  console.log(`
Next step:  npm run finetune:submit
`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
