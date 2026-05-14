/**
 * POST /api/extract-app-data
 *
 * Accepts a single document image (base64 + mimeType) — a TTB COLA application
 * form, scanned application, or any document containing filed application data —
 * and uses Claude Haiku Vision to extract the structured ApplicationData fields.
 *
 * Returns the extracted data for the user to review and edit before verification.
 */

import { NextRequest, NextResponse } from "next/server";
import { analyzeApplicationDocument } from "@/lib/ai-analyzer";

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your-anthropic-api-key-here") {
    return NextResponse.json(
      { error: "Anthropic API key not configured — document extraction is unavailable." },
      { status: 503 }
    );
  }

  let body: { base64: string; mimeType: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { base64, mimeType } = body;
  if (!base64 || !mimeType) {
    return NextResponse.json(
      { error: "Request must include base64 and mimeType." },
      { status: 400 }
    );
  }

  try {
    const result = await analyzeApplicationDocument({ base64, mimeType });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Application document extraction failed:", err);
    return NextResponse.json(
      { error: "Extraction failed. Please fill in the fields manually." },
      { status: 500 }
    );
  }
}
