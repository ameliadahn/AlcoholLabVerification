# TTB Alcohol Label Verification — AI-Assisted POC

A standalone proof-of-concept application for AI-assisted alcohol label compliance review, built for TTB compliance agents.

## Overview

This application automates the tedious manual work of comparing distilled spirits label artwork against application data. It uses in-browser OCR (Tesseract.js) to extract text from label images and applies a rule-based compliance engine against all mandatory TTB label requirements.

## Features

- **Drag & Drop Upload** — JPG, PNG, and PDF label images; single and batch (50+ labels)
- **OCR Text Extraction** — Powered by Tesseract.js, runs entirely in the browser
- **AI-Assisted Field Parsing** — Automatically extracts brand name, class/type, ABV, net contents, bottler info, government warning, and country of origin
- **Full TTB Compliance Validation** — All 7 mandatory label elements per TTB distilled spirits regulations
- **Confidence Scoring** — OCR confidence ≥ 85% for auto-validation; below 85% triggers manual review
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

1. **Upload Labels** — Drag and drop one or multiple label images
2. **Enter Application Data** — Provide the form data to compare against
3. **Run Verification** — AI processes each label with OCR + compliance rules
4. **Review Results** — Examine pass/fail/review status per field, apply overrides

## Tech Stack

- **Next.js 16** (App Router) + **TypeScript**
- **TailwindCSS** for styling
- **Tesseract.js** for client-side OCR
- **react-dropzone** for file upload UX

## Architecture Notes

- All OCR processing runs client-side — no label image data is sent to external servers
- Validation logic is fully local and transparent
- Designed for government-network-compatible deployment (minimal external dependencies)
