export type ValidationStatus = "pass" | "fail" | "review";

export interface FieldValidationResult {
  field: string;
  status: ValidationStatus;
  extractedValue: string | null;
  expectedValue: string | null;
  confidence: number;
  message: string;
  detail?: string;
}

export interface LabelValidationResult {
  id: string;
  /** All panel filenames (front, back, neck, etc.) */
  fileNames: string[];
  /** Object URLs for all uploaded panels */
  imageUrls: string[];
  /** Number of panels in this submission */
  panelCount: number;
  overallStatus: ValidationStatus;
  processedAt: string;
  processingTimeMs: number;
  /** Concatenated OCR text from all panels */
  ocrText: string;
  ocrConfidence: number;
  /** The application record matched from the JSON registry, or null if unmatched */
  matchedApplicationId: string | null;
  matchedApplicationData: ApplicationData | null;
  unmatched: boolean;
  /** Whether GPT-4o Vision was used (true) or Tesseract OCR fallback (false) */
  usedAi?: boolean;
  /** Notes from the AI analysis (image quality, legibility issues, etc.) */
  analysisNotes?: string;
  fields: {
    brandName: FieldValidationResult;
    classType: FieldValidationResult;
    alcoholContent: FieldValidationResult;
    netContents: FieldValidationResult;
    bottlerImporter: FieldValidationResult;
    governmentWarning: FieldValidationResult;
    countryOfOrigin: FieldValidationResult;
    prohibitedClaims: FieldValidationResult;
  };
  fieldOfVision: FieldValidationResult;
  reviewerOverride?: {
    status: ValidationStatus;
    notes: string;
    reviewedAt: string;
  };
}

export interface ApplicationData {
  brandName: string;
  classType: string;
  alcoholContent: string;
  netContents: string;
  /** Optional — used for bottler name comparison in validation when provided */
  bottlerName?: string;
  bottlerCity: string;
  bottlerState: string;
  /** Optional combined bottler name and address — used for comprehensive bottler matching.
   *  When provided, takes precedence over bottlerName for validation.
   *  Example: "Greenmeadow Distilling Co., Portland, OR" */
  bottlerAddress?: string;
  isImported: boolean;
  countryOfOrigin: string;
}

export interface ProcessLabelRequest {
  imageDataUrl: string;
  fileName: string;
  applicationData: ApplicationData;
}

export interface BatchProcessRequest {
  labels: ProcessLabelRequest[];
}

export type ProcessingStatus = "idle" | "uploading" | "processing" | "complete" | "error";

/** A single uploaded panel image (front, back, neck, cap, etc.) */
export interface PanelUpload {
  id: string;
  file: File;
  previewUrl: string;
  /** Human-readable panel label inferred from filename suffix (e.g. "Front", "Back") */
  panelLabel: string;
}

/** A multi-panel label submission — all panels belong to the same application */
export interface LabelSubmission {
  id: string;
  panels: PanelUpload[];
  status: ProcessingStatus;
  result?: LabelValidationResult;
  error?: string;
}

export type BatchSubmissionStatus = "pending" | "processing" | "complete" | "error";

/** One label in a batch run — folder name acts as the application ID hint */
export interface BatchLabelSubmission {
  id: string;
  /** Folder name or filename prefix used as the application ID */
  submissionLabel: string;
  panels: PanelUpload[];
  status: BatchSubmissionStatus;
  /** Set from manifest upload; if absent the server uses registry lookup */
  applicationData?: ApplicationData;
  result?: LabelValidationResult;
  error?: string;
}

/** @deprecated Use PanelUpload instead. Kept for compatibility during migration. */
export type LabelUpload = PanelUpload & {
  status: ProcessingStatus;
  result?: LabelValidationResult;
  error?: string;
};

export const CLASS_TYPES = [
  "Vodka",
  "Whiskey",
  "Bourbon Whiskey",
  "Scotch Whiskey",
  "Rum",
  "Gin",
  "Brandy",
  "Cognac",
  "Tequila",
  "Mezcal",
  "Liqueur",
  "Cordial",
  "Neutral Spirits",
  "Grain Spirits",
  "Other",
] as const;

export type ClassType = (typeof CLASS_TYPES)[number];
