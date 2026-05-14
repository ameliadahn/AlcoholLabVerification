#!/usr/bin/env node
/**
 * Fine-tuning Script 1 — Generate Extractions
 * ─────────────────────────────────────────────
 * Runs the current GPT-4o model on every sample label and saves its raw output
 * to scripts/extractions/{labelId}.json alongside the application data and
 * expected result from application-data.json.
 *
 * AFTER running this script:
 *   1. Open each file in scripts/extractions/.
 *   2. Review the "gptOutput" section.
 *   3. Where GPT-4o made a mistake, add your corrected version to the
 *      "correction" field (copy gptOutput and fix the wrong values).
 *   4. Where GPT-4o was already correct, set "correction" to the string
 *      "USE_GPT_OUTPUT" — script 2 will use the existing gptOutput as-is.
 *   5. Leave "correction" as null to skip that label entirely.
 *
 * Usage:
 *   npm run finetune:generate
 *   — or —
 *   node scripts/1-generate-extractions.mjs
 *
 * Flags:
 *   --only=labelId   Process a single label (e.g. --only=pineRidgeLabel)
 *   --force          Re-run even if an extraction file already exists
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { loadApiKey, ROOT } from "./lib/env.mjs";
import { SYSTEM_PROMPT, buildUserPrompt } from "./lib/prompts.mjs";

// ─── Config ──────────────────────────────────────────────────────────────────

const LABELS_DIR = path.join(ROOT, "public", "sampleLabels");
const REGISTRY_PATH = path.join(ROOT, "public", "application-data.json");
const OUTPUT_DIR = path.join(ROOT, "scripts", "extractions");
const MODEL = "gpt-4o";

const args = process.argv.slice(2);
const onlyFlag = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const forceFlag = args.includes("--force");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadRegistry() {
  const raw = fs.readFileSync(REGISTRY_PATH, "utf-8");
  const records = JSON.parse(raw);
  if (!Array.isArray(records)) throw new Error("application-data.json must be an array");
  const map = new Map();
  for (const r of records) map.set(r.id, r);
  return map;
}

/**
 * Recursively finds all label directories inside LABELS_DIR.
 * A "label directory" is any folder that directly contains at least one .png file.
 * Returns: [{ labelId, dirPath, panelFiles }]
 */
function discoverLabels() {
  const results = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const pngs = entries
      .filter((e) => e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name))
      .map((e) => e.name)
      .sort();

    if (pngs.length > 0) {
      const labelId = path.basename(dir);
      results.push({ labelId, dirPath: dir, panelFiles: pngs });
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
  }

  walk(LABELS_DIR);
  return results;
}

/**
 * Reads an image file and returns it as a base64 string + MIME type.
 */
function imageToBase64(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
  const mimeType = mimeMap[ext] ?? "image/png";
  const base64 = fs.readFileSync(filePath).toString("base64");
  return { base64, mimeType };
}

/**
 * Strips panel separator markers that GPT-4o occasionally injects into field
 * values (same post-processing as the production analyzeLabel function).
 */
function sanitize(value) {
  if (!value) return null;
  const cleaned = value
    .replace(/---\s*\[Panel\s*\d+[^\]]*\]\s*---/gi, "")
    .replace(/^\s*[-—]+\s*|\s*[-—]+\s*$/g, "")
    .trim();
  return cleaned || null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  loadApiKey();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const registry = loadRegistry();
  let labels = discoverLabels();

  if (onlyFlag) {
    labels = labels.filter((l) => l.labelId === onlyFlag);
    if (labels.length === 0) {
      console.error(`No label directory found for --only=${onlyFlag}`);
      console.error("Available labels:", discoverLabels().map((l) => l.labelId).join(", "));
      process.exit(1);
    }
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`\n🏷  Found ${labels.length} label(s) to process\n`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const { labelId, dirPath, panelFiles } of labels) {
    const outputPath = path.join(OUTPUT_DIR, `${labelId}.json`);

    if (!forceFlag && fs.existsSync(outputPath)) {
      console.log(`  ⏭  ${labelId} — already extracted (use --force to re-run)`);
      skipped++;
      continue;
    }

    const appRecord = registry.get(labelId);
    if (!appRecord) {
      console.warn(`  ⚠️  ${labelId} — no matching record in application-data.json, skipping`);
      skipped++;
      continue;
    }

    console.log(`  🔍 ${labelId} (${panelFiles.length} panel${panelFiles.length !== 1 ? "s" : ""})`);

    try {
      // Build image blocks — same approach as production analyzeLabel()
      const imageBlocks = panelFiles.map((fileName) => {
        const { base64, mimeType } = imageToBase64(path.join(dirPath, fileName));
        return {
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${base64}`,
            detail: "auto",
          },
        };
      });

      const userPromptText = buildUserPrompt(appRecord.applicationData, panelFiles);

      const response = await client.chat.completions.create({
        model: MODEL,
        max_tokens: 2000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              ...imageBlocks,
              { type: "text", text: userPromptText },
            ],
          },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("OpenAI returned an empty response");

      const parsed = JSON.parse(content);

      // Apply the same sanitization as production
      const gptOutput = {
        rawText: parsed.rawText ?? "",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 75,
        extractedFields: {
          brandName: sanitize(parsed.extractedFields?.brandName),
          classType: sanitize(parsed.extractedFields?.classType),
          alcoholContent: sanitize(parsed.extractedFields?.alcoholContent),
          netContents: sanitize(parsed.extractedFields?.netContents),
          bottlerStatement: sanitize(parsed.extractedFields?.bottlerStatement),
          governmentWarning: sanitize(parsed.extractedFields?.governmentWarning),
          countryOfOrigin: sanitize(parsed.extractedFields?.countryOfOrigin),
          prohibitedClaims: sanitize(parsed.extractedFields?.prohibitedClaims),
        },
        analysisNotes: parsed.analysisNotes ?? "",
      };

      const outputData = {
        labelId,
        expectedResult: appRecord.expectedResult,
        reasonForResult: appRecord.reasonForResult,
        applicationData: appRecord.applicationData,
        submissionDir: path.relative(ROOT, dirPath),
        panelFiles,
        gptOutput,
        /**
         * INSTRUCTIONS — fill this in before running script 2:
         *
         * Option A — GPT was wrong on some fields:
         *   Copy the entire "gptOutput" block, paste it here as "correction",
         *   then fix only the fields that were wrong.
         *
         * Option B — GPT was completely correct:
         *   Set this to the string "USE_GPT_OUTPUT" and script 2 will use
         *   gptOutput directly without any edits.
         *
         * Option C — Skip this label:
         *   Leave as null (default). Script 2 will skip it with a warning.
         */
        correction: null,
      };

      fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), "utf-8");
      console.log(`     ✅ Saved → ${path.relative(ROOT, outputPath)}`);
      processed++;
    } catch (err) {
      console.error(`     ❌ Error processing ${labelId}: ${err.message}`);
      errors++;
    }

    // Small delay between API calls to stay within rate limits
    if (labels.indexOf({ labelId, dirPath, panelFiles }) < labels.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅  Processed : ${processed}
  ⏭  Skipped   : ${skipped}
  ❌  Errors    : ${errors}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Next step:
  Open each file in scripts/extractions/ and review the "gptOutput".
  For each label, set "correction" to either:
    • A corrected copy of gptOutput (fix wrong fields)
    • The string "USE_GPT_OUTPUT"  (gptOutput was already perfect)
    • null                          (skip this label — not recommended)

  Then run:  npm run finetune:build
`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
