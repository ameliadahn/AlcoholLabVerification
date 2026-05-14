# TTB Alcohol Label Verification — AI-Assisted POC

A standalone proof-of-concept application for AI-assisted alcohol label compliance review, built for TTB compliance agents.

## Overview

This application automates the tedious manual work of comparing distilled spirits label artwork against application data. It uses Claude Haiku Vision (server-side) to extract structured fields from label images, client-side Tesseract.js OCR specifically for government warning verification, and a deterministic validation engine to check all mandatory TTB label requirements.

## Features

- **Drag & Drop Upload** — JPG, PNG, and PDF label images; single-label and batch (up to 15 labels)
- **Multi-Panel Support** — Upload front, back, neck, cap, and other panels per submission; all panels are analyzed together as a set
- **Claude Vision Field Extraction** — Extracts brand name, class/type, ABV, net contents, bottler info, and country of origin from label images via Anthropic's API
- **Government Warning OCR** — Tesseract.js runs in-browser specifically to verify the government warning text, preventing AI from falsely passing a missing or illegible warning
- **Prohibited Claims Detection** — Flags clearly prohibited marketing claims as fails; claims requiring supporting documentation as review
- **Full TTB Compliance Validation** — All 7 mandatory label elements per TTB distilled spirits regulations
- **Confidence Scoring** — AI confidence < 50 auto-fails; confidence < 70 triggers manual review; ≥ 70 passes
- **Color-coded Results** — Green (Pass), Red (Fail), Yellow (Review Required)
- **Reviewer Override** — Compliance agents can override AI determinations with notes
- **Side-by-Side Comparison** — Extracted label values vs. application data

## TTB Validation Rules

| Rule | Description |
|------|-------------|
| Brand Name | Presence and match against application data |
| Class/Type | Valid TTB-recognized designation (Vodka, Whiskey, Rum, etc.) |
| Alcohol Content | Must include `%`, `Alc.`/`Alcohol`, `Vol.`/`Volume` — "ABV" alone fails |
| Net Contents | Must be in metric units (mL or L) |
| Bottler/Importer | Requires qualifying phrase + city + two-letter state |
| Government Warning | Both numbered sections, "GOVERNMENT WARNING" in all caps |
| Country of Origin | Required for imported products only |
| Field of Vision | Brand, class/type, and ABV must appear together |

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Workflow

### Single Label
1. **Upload Panels** — Drag and drop one or more panel images for the label
2. **Enter Application Data** — Fill in the form manually, upload a document for AI extraction, or use demo mode for pre-loaded records
3. **Run Verification** — Claude Vision analyzes all panels; Tesseract verifies the government warning in parallel
4. **Review Results** — Examine pass/fail/review status per field, read validation summaries, apply overrides

### Batch
1. **Upload a Label Folder** — Drop a folder of label images
2. **Provide a Manifest** — Upload a CSV or Excel file mapping application data to label filenames
3. **Run Batch** — Up to 15 submissions processed concurrently (max 7 at a time) with automatic rate-limit handling
4. **Review Results** — Aggregate pass/fail/review with per-submission detail and override controls

## Environment Setup

Copy `.env.example` to `.env.local` and add your Anthropic API key:

```bash
cp .env.example .env.local
```

```
ANTHROPIC_API_KEY=your_key_here
```

## Tech Stack

- **Next.js 16** (App Router) + **TypeScript**
- **TailwindCSS** for styling
- **Anthropic Claude Haiku** (`@anthropic-ai/sdk`) for vision-based field extraction — runs server-side
- **Tesseract.js** for in-browser OCR (government warning verification only)
- **react-dropzone** for file upload UX
- **papaparse** + **xlsx** for CSV/Excel manifest parsing
- **pdfjs-dist** for in-browser PDF text extraction

## Architecture Notes

- **Label images are sent to Anthropic's API** via the Next.js server for vision analysis. Only the government warning OCR path runs entirely client-side.
- The Anthropic API key is handled server-side only and is never exposed to the browser.
- No label image data is stored — images are processed in memory and discarded after each request.
- Validation logic runs server-side and is fully deterministic and transparent.
- A `scripts/` directory contains an offline fine-tuning pipeline (OpenAI) that is not required to run the application.
