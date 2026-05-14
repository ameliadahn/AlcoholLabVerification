#!/usr/bin/env node
/**
 * Fine-tuning Script 3 — Submit Fine-tuning Job
 * ────────────────────────────────────────────────
 * Uploads scripts/training.jsonl to OpenAI and creates a fine-tuning job.
 * When the job finishes (typically 15–60 minutes), OpenAI emails you and the
 * fine-tuned model name becomes available in your dashboard.
 *
 * The job ID and model name are saved to scripts/finetune-job.json so you
 * can check status later without the dashboard.
 *
 * Usage:
 *   npm run finetune:submit
 *   — or —
 *   node scripts/3-submit-finetune.mjs
 *
 * Flags:
 *   --model=<name>   Base model to fine-tune (default: gpt-4o-mini-2024-07-18)
 *   --epochs=<n>     Number of training epochs — omit for OpenAI auto (recommended)
 *   --suffix=<name>  Short suffix added to the output model name (e.g. "ttb-v1")
 *   --status         Check status of the most recent job (no upload)
 *   --list           List your 10 most recent fine-tuning jobs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { loadApiKey, ROOT } from "./lib/env.mjs";

// ─── Config ──────────────────────────────────────────────────────────────────

const TRAINING_FILE = path.join(ROOT, "scripts", "training.jsonl");
const JOB_RECORD_PATH = path.join(ROOT, "scripts", "finetune-job.json");

// gpt-4o-mini-2024-07-18 is the most cost-effective option that supports
// vision fine-tuning.  Switch to "gpt-4o-2024-08-06" for maximum accuracy
// (approx. 10× more expensive per training token).
const DEFAULT_MODEL = "gpt-4o-mini-2024-07-18";

const args = process.argv.slice(2);
const modelFlag = args.find((a) => a.startsWith("--model="))?.split("=")[1] ?? DEFAULT_MODEL;
const epochsFlag = args.find((a) => a.startsWith("--epochs="))?.split("=")[1];
const suffixFlag = args.find((a) => a.startsWith("--suffix="))?.split("=")[1] ?? "ttb-reviewer";
const statusFlag = args.includes("--status");
const listFlag = args.includes("--list");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function saveJobRecord(data) {
  fs.writeFileSync(JOB_RECORD_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function loadJobRecord() {
  if (!fs.existsSync(JOB_RECORD_PATH)) return null;
  return JSON.parse(fs.readFileSync(JOB_RECORD_PATH, "utf-8"));
}

function statusEmoji(status) {
  const map = {
    validating_files: "🔎",
    queued: "⏳",
    running: "🏃",
    succeeded: "✅",
    failed: "❌",
    cancelled: "🚫",
  };
  return map[status] ?? "❓";
}

function formatJobSummary(job) {
  const emoji = statusEmoji(job.status);
  const created = new Date(job.created_at * 1000).toLocaleString();
  const lines = [
    `  ${emoji} Job ID    : ${job.id}`,
    `     Status   : ${job.status}`,
    `     Model    : ${job.model}`,
    `     Created  : ${created}`,
  ];
  if (job.fine_tuned_model) {
    lines.push(`     Output   : ${job.fine_tuned_model}`);
  }
  if (job.status === "failed" && job.error) {
    lines.push(`     Error    : ${job.error.message}`);
  }
  return lines.join("\n");
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function checkStatus(client) {
  const record = loadJobRecord();
  if (!record?.jobId) {
    console.error("No job record found. Submit a job first (omit --status flag).");
    process.exit(1);
  }

  console.log(`\nChecking status for job: ${record.jobId}\n`);
  const job = await client.fineTuning.jobs.retrieve(record.jobId);
  console.log(formatJobSummary(job));

  if (job.fine_tuned_model) {
    // Update local record with the finished model name
    saveJobRecord({ ...record, fineTunedModel: job.fine_tuned_model, status: job.status });
    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Fine-tuned model is ready!

  Model name:  ${job.fine_tuned_model}

  To use it in your app, open lib/ai-analyzer.ts and change the model
  on the client.chat.completions.create() call from "gpt-4o" to:

    model: "${job.fine_tuned_model}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
  } else if (job.status === "running" || job.status === "queued") {
    console.log("\n  Still running — check again in a few minutes.\n");
  }
}

async function listJobs(client) {
  console.log("\n📋 Your 10 most recent fine-tuning jobs:\n");
  const response = await client.fineTuning.jobs.list({ limit: 10 });
  for (const job of response.data) {
    console.log(formatJobSummary(job));
    console.log("");
  }
}

async function submitJob(client) {
  if (!fs.existsSync(TRAINING_FILE)) {
    console.error(`training.jsonl not found at ${TRAINING_FILE}.\nRun script 2 first: npm run finetune:build`);
    process.exit(1);
  }

  const fileStats = fs.statSync(TRAINING_FILE);
  const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(2);
  const lineCount = fs.readFileSync(TRAINING_FILE, "utf-8").trim().split("\n").length;

  console.log(`
📄 Training file : scripts/training.jsonl
   Size          : ${fileSizeMB} MB
   Examples      : ${lineCount}
   Base model    : ${modelFlag}
   Suffix        : ${suffixFlag}
   Epochs        : ${epochsFlag ?? "auto (recommended)"}
`);

  if (lineCount < 10) {
    console.warn(`  ⚠️  Only ${lineCount} training example(s). OpenAI may reject the job or produce a
     low-quality model. Aim for at least 50 examples before submitting.
`);
  }

  // ── Step 1: Upload the training file ─────────────────────────────────────
  console.log("  ⬆️  Uploading training file to OpenAI…");

  let uploadedFile;
  try {
    uploadedFile = await client.files.create({
      file: fs.createReadStream(TRAINING_FILE),
      purpose: "fine-tune",
    });
  } catch (err) {
    console.error(`  ❌ File upload failed: ${err.message}`);
    process.exit(1);
  }

  console.log(`     File ID: ${uploadedFile.id}`);

  // ── Step 2: Create the fine-tuning job ────────────────────────────────────
  console.log("  🚀 Creating fine-tuning job…");

  const hyperparameters = {};
  if (epochsFlag) hyperparameters.n_epochs = parseInt(epochsFlag, 10);

  let job;
  try {
    job = await client.fineTuning.jobs.create({
      training_file: uploadedFile.id,
      model: modelFlag,
      suffix: suffixFlag,
      ...(Object.keys(hyperparameters).length > 0 ? { hyperparameters } : {}),
    });
  } catch (err) {
    console.error(`  ❌ Job creation failed: ${err.message}`);
    process.exit(1);
  }

  // Save the job record locally
  saveJobRecord({
    jobId: job.id,
    trainingFileId: uploadedFile.id,
    baseModel: modelFlag,
    suffix: suffixFlag,
    status: job.status,
    submittedAt: new Date().toISOString(),
    fineTunedModel: null,
  });

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅  Fine-tuning job submitted successfully!

  Job ID      : ${job.id}
  Status      : ${job.status}
  Base model  : ${job.model}

  Training typically takes 15–60 minutes depending on dataset size.
  OpenAI will email you when it's done.

  To check status at any time, run:
    node scripts/3-submit-finetune.mjs --status

  Or view your jobs on the OpenAI dashboard:
    https://platform.openai.com/finetune

  Job details saved to: scripts/finetune-job.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  loadApiKey();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (listFlag) {
    await listJobs(client);
  } else if (statusFlag) {
    await checkStatus(client);
  } else {
    await submitJob(client);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
