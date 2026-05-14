/**
 * Reads OPENAI_API_KEY from the project's .env.local file.
 * Call this at the top of each script before using the OpenAI client.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function loadApiKey() {
  // Honour the environment variable if it's already set (e.g. CI / shell export)
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;

  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(
      `.env.local not found at ${envPath}. ` +
        "Create it with a line: OPENAI_API_KEY=sk-..."
    );
  }

  const content = fs.readFileSync(envPath, "utf-8");
  const match = content.match(/^OPENAI_API_KEY\s*=\s*(.+)$/m);
  if (!match) {
    throw new Error("OPENAI_API_KEY not found in .env.local");
  }

  const key = match[1].trim();
  process.env.OPENAI_API_KEY = key; // make it available to the OpenAI SDK
  return key;
}

export { ROOT };
