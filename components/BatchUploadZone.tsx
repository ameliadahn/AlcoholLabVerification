"use client";

/**
 * BatchUploadZone
 *
 * Folder-only batch upload. Accepts:
 *   • Drag-and-drop of one or more folders
 *   • A parent folder whose subfolders each hold one label's images
 *   • Click-to-browse opens a folder picker (webkitdirectory)
 *
 * In all cases the component walks to the deepest ("leaf") directories —
 * directories that contain image files but no sub-directories — and turns
 * each one into a BatchLabelSubmission. Individual image files dropped
 * directly are rejected with an error hint.
 *
 * Calls `onSubmissionsAdded` with any newly detected submissions.
 * The parent is responsible for maintaining the full list.
 */

import { useCallback, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { BatchLabelSubmission, PanelUpload } from "@/lib/types";
import { inferPanelLabel, PANEL_SUFFIX_PATTERN } from "@/lib/panel-utils";

interface BatchUploadZoneProps {
  onSubmissionsAdded: (submissions: BatchLabelSubmission[]) => void;
  disabled?: boolean;
}

const IMAGE_EXT = /\.(jpe?g|png|pdf)$/i;

// ── Directory traversal (drag-and-drop path) ──────────────────────────────────

/** Read all immediate entries from a directory (handles the 100-entry readEntries limit). */
async function readAllEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  await new Promise<void>((resolve) => {
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) { resolve(); return; }
        all.push(...batch);
        readBatch();
      }, () => resolve());
    };
    readBatch();
  });
  return all;
}

interface LeafFolder { name: string; files: File[] }

/**
 * Recursively walk a directory entry tree.
 * Returns one LeafFolder per directory that has images but no sub-directories.
 */
async function findLeafFolders(entry: FileSystemDirectoryEntry): Promise<LeafFolder[]> {
  const entries = await readAllEntries(entry);

  const subdirs = entries.filter((e) => e.isDirectory) as FileSystemDirectoryEntry[];
  const imageEntries = entries.filter(
    (e) => e.isFile && IMAGE_EXT.test(e.name)
  ) as FileSystemFileEntry[];

  if (subdirs.length === 0) {
    // Leaf directory — resolve image files
    const files = (
      await Promise.all(
        imageEntries.map(
          (fe) => new Promise<File | null>((resolve) => fe.file(resolve, () => resolve(null)))
        )
      )
    ).filter(Boolean) as File[];

    if (files.length === 0) return [];
    return [{ name: entry.name, files: files.sort((a, b) => a.name.localeCompare(b.name)) }];
  }

  // Intermediate directory — recurse
  const results: LeafFolder[] = [];
  for (const subdir of subdirs) {
    results.push(...(await findLeafFolders(subdir)));
  }
  return results;
}

// ── Folder-picker path (webkitdirectory input) ────────────────────────────────

/**
 * Given the flat file list from a webkitdirectory input, find leaf sub-folders
 * (folders that hold images but have no child folders).
 *
 * webkitRelativePath looks like:  "parent/label1/front.jpg"
 * We reconstruct the folder tree from those paths.
 */
function findLeafFoldersFromPicker(files: File[]): LeafFolder[] {
  const imageFiles = files.filter((f) => IMAGE_EXT.test(f.name));
  if (imageFiles.length === 0) return [];

  // Map folder path → files in that folder
  const folderFiles = new Map<string, File[]>();
  // Track which folders are non-leaf (have at least one child folder)
  const nonLeaf = new Set<string>();

  for (const file of imageFiles) {
    const relPath = (file as File & { webkitRelativePath: string }).webkitRelativePath;
    if (!relPath) continue;
    const parts = relPath.split("/");
    const folderPath = parts.slice(0, -1).join("/");

    if (!folderFiles.has(folderPath)) folderFiles.set(folderPath, []);
    folderFiles.get(folderPath)!.push(file);

    // Every ancestor above this folder is non-leaf
    for (let depth = 1; depth < parts.length - 1; depth++) {
      nonLeaf.add(parts.slice(0, depth).join("/"));
    }
  }

  const results: LeafFolder[] = [];
  for (const [folderPath, folderFileList] of folderFiles.entries()) {
    if (!nonLeaf.has(folderPath)) {
      results.push({
        name: folderPath.split("/").pop() || folderPath,
        files: folderFileList.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
  }
  return results;
}

// ── Shared helper ─────────────────────────────────────────────────────────────

function leafFolderToSubmission({ name, files }: LeafFolder): BatchLabelSubmission {
  const panels: PanelUpload[] = files.map((file, i) => {
    const ext = file.name.split(".").pop() ?? "jpg";
    // Rename so normalizeId can strip the trailing counter and match the registry
    const effectiveFile = new File([file], `${name}${i + 1}.${ext}`, { type: file.type });
    const inferred = inferPanelLabel(file.name);
    const panelLabel =
      inferred === "Front" || !PANEL_SUFFIX_PATTERN.test(file.name)
        ? `Panel ${i + 1}`
        : inferred;
    return { id: uuidv4(), file: effectiveFile, previewUrl: URL.createObjectURL(file), panelLabel };
  });
  return { id: uuidv4(), submissionLabel: name, panels, status: "pending" };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BatchUploadZone({ onSubmissionsAdded, disabled }: BatchUploadZoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [rejectHint, setRejectHint] = useState<string | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const showReject = (msg: string) => {
    setRejectHint(msg);
    setTimeout(() => setRejectHint(null), 2500);
  };

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragActive(false);
      if (disabled) return;

      const items = Array.from(e.dataTransfer.items).filter((i) => i.kind === "file");

      // Check for bare files (not in a folder)
      const hasLooseFiles = items.some((item) => {
        const entry = item.webkitGetAsEntry?.();
        return entry?.isFile;
      });
      const hasDirectories = items.some((item) => {
        const entry = item.webkitGetAsEntry?.();
        return entry?.isDirectory;
      });

      if (hasLooseFiles && !hasDirectories) {
        showReject("Please drop folders, not individual files. Each label's images must be in their own folder.");
        return;
      }

      const leaves: LeafFolder[] = [];
      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (!entry?.isDirectory) continue;
        leaves.push(...(await findLeafFolders(entry as FileSystemDirectoryEntry)));
      }

      if (leaves.length === 0) {
        showReject("No image files found inside the dropped folders.");
        return;
      }

      onSubmissionsAdded(leaves.map(leafFolderToSubmission));
    },
    [disabled, onSubmissionsAdded]
  );

  const handleFolderInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (files.length === 0) return;

      const leaves = findLeafFoldersFromPicker(files);
      if (leaves.length === 0) {
        showReject("No supported image files found in the selected folder.");
        return;
      }
      onSubmissionsAdded(leaves.map(leafFolderToSubmission));
    },
    [onSubmissionsAdded]
  );

  const isDragReject = rejectHint !== null;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragActive(true); }}
      onDragLeave={() => setIsDragActive(false)}
      onDrop={handleDrop}
      onClick={() => { if (!disabled) folderInputRef.current?.click(); }}
      className={`
        relative border-2 border-dashed rounded-xl p-10 text-center transition-all duration-200 cursor-pointer
        ${isDragActive ? "border-blue-400 bg-blue-50" : ""}
        ${isDragReject ? "border-red-400 bg-red-50" : ""}
        ${!isDragActive && !isDragReject && !disabled ? "border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50" : ""}
        ${disabled ? "border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed" : ""}
      `}
    >
      {/* Folder picker — webkitdirectory lets the picker traverse subfolders */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={handleFolderInput}
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
      />

      <div className="flex flex-col items-center gap-3">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center
          ${isDragActive ? "bg-blue-100" : isDragReject ? "bg-red-100" : "bg-gray-100"}`}>
          <svg
            className={`w-7 h-7 ${isDragActive ? "text-blue-500" : isDragReject ? "text-red-500" : "text-gray-400"}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M16 10H8m4-4v8" />
          </svg>
        </div>

        {isDragReject ? (
          <div className="space-y-1">
            <p className="text-red-600 font-semibold text-sm">Cannot add files</p>
            <p className="text-red-500 text-xs max-w-xs">{rejectHint}</p>
          </div>
        ) : isDragActive ? (
          <p className="text-blue-600 font-semibold">Drop label folders here</p>
        ) : (
          <>
            <div>
              <p className="text-gray-700 font-semibold">
                Drag &amp; drop label folders here
              </p>
              <p className="text-gray-500 text-sm mt-1">
                or click to browse for a folder
              </p>
            </div>

            <div className="flex flex-col items-center gap-1.5 mt-1">
              <div className="flex items-start gap-2 text-xs text-gray-500 max-w-sm text-left bg-white border border-gray-200 rounded-lg px-4 py-2.5">
                <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  Drop <strong>multiple folders</strong> at once, or drop a
                  <strong> parent folder</strong> whose subfolders each hold one
                  label&apos;s images. The deepest folders become the submissions.
                </span>
              </div>
            </div>

            <p className="text-xs text-gray-400">
              JPG, PNG, PDF · Each label must be in its own folder
            </p>
          </>
        )}
      </div>
    </div>
  );
}
