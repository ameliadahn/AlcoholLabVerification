"use client";

import { useCallback, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";

interface UploadZoneProps {
  onFilesAdded: (files: File[], folderName?: string) => void;
  disabled?: boolean;
}

const ACCEPTED_TYPES = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "application/pdf": [".pdf"],
};

const IMAGE_EXT = /\.(jpe?g|png|pdf)$/i;

async function readDirectoryEntry(dir: FileSystemDirectoryEntry): Promise<File[]> {
  const reader = dir.createReader();
  const allEntries: FileSystemEntry[] = [];

  await new Promise<void>((resolve) => {
    const readBatch = () => {
      reader.readEntries((entries) => {
        if (entries.length === 0) { resolve(); return; }
        allEntries.push(...entries);
        readBatch();
      }, () => resolve());
    };
    readBatch();
  });

  const files: File[] = [];
  for (const entry of allEntries) {
    if (entry.isFile && IMAGE_EXT.test(entry.name)) {
      const file = await new Promise<File | null>((resolve) => {
        (entry as FileSystemFileEntry).file(resolve, () => resolve(null));
      });
      if (file) files.push(file);
    }
  }
  return files;
}

export default function UploadZone({ onFilesAdded, disabled }: UploadZoneProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [showChoice, setShowChoice] = useState(false);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onFilesAdded(acceptedFiles);
      }
    },
    [onFilesAdded]
  );

  const handleFolderInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []).filter((f) =>
        IMAGE_EXT.test(f.name)
      );
      if (files.length === 0) return;
      const folderName = (files[0] as File & { webkitRelativePath: string })
        .webkitRelativePath.split("/")[0];
      onFilesAdded(files, folderName || undefined);
      e.target.value = "";
    },
    [onFilesAdded]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject, open } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    disabled,
    maxSize: 20 * 1024 * 1024,
    noClick: true, // we handle click ourselves to show the choice overlay
  });

  const { onDrop: rzOnDrop, ...restRootProps } = getRootProps();

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      setShowChoice(false);
      const items = Array.from(e.dataTransfer?.items ?? []);
      const dirItem = items.find((item) => item.webkitGetAsEntry?.()?.isDirectory);

      if (dirItem) {
        e.preventDefault();
        e.stopPropagation();
        const entry = dirItem.webkitGetAsEntry() as FileSystemDirectoryEntry;
        readDirectoryEntry(entry).then((files) => {
          if (files.length > 0) onFilesAdded(files, entry.name);
        });
      } else {
        rzOnDrop?.(e);
      }
    },
    [onFilesAdded, rzOnDrop]
  );

  return (
    <div
      {...restRootProps}
      onDrop={handleDrop}
      onClick={() => { if (!disabled) setShowChoice(true); }}
      className={`
        relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-200
        ${isDragActive && !isDragReject ? "border-blue-400 bg-blue-50" : ""}
        ${isDragReject ? "border-red-400 bg-red-50" : ""}
        ${!isDragActive && !disabled ? "border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50" : ""}
        ${disabled ? "border-gray-200 bg-gray-50 cursor-not-allowed opacity-60" : ""}
      `}
    >
      <input {...getInputProps()} />

      {/* Hidden folder input */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        multiple
        accept="image/jpeg,image/png,application/pdf"
        className="hidden"
        onChange={handleFolderInput}
        disabled={disabled}
      />

      {/* Inline picker choice overlay */}
      {showChoice && !isDragActive && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/95 backdrop-blur-sm"
          onClick={(e) => { e.stopPropagation(); setShowChoice(false); }}
        >
          <div
            className="flex gap-4 p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Select Images tile */}
            <button
              type="button"
              onClick={() => {
                setShowChoice(false);
                open();
              }}
              className="flex flex-col items-center gap-3 w-40 py-6 px-4 rounded-xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 hover:border-blue-400 transition-all group"
            >
              <div className="w-12 h-12 rounded-full bg-blue-100 group-hover:bg-blue-200 flex items-center justify-center transition-colors">
                <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-800">Select Images</p>
                <p className="text-xs text-blue-600 mt-0.5">JPG, PNG, PDF</p>
              </div>
            </button>

            {/* Select Folder tile */}
            <button
              type="button"
              onClick={() => {
                setShowChoice(false);
                folderInputRef.current?.click();
              }}
              className="flex flex-col items-center gap-3 w-40 py-6 px-4 rounded-xl border-2 border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-400 transition-all group"
            >
              <div className="w-12 h-12 rounded-full bg-gray-100 group-hover:bg-gray-200 flex items-center justify-center transition-colors">
                <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Select Folder</p>
                <p className="text-xs text-gray-500 mt-0.5">All images inside</p>
              </div>
            </button>
          </div>

          <p className="absolute bottom-4 text-xs text-gray-400">click outside to cancel</p>
        </div>
      )}

      <div className="flex flex-col items-center gap-3">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center
          ${isDragActive && !isDragReject ? "bg-blue-100" : "bg-gray-100"}
          ${isDragReject ? "bg-red-100" : ""}
        `}>
          <svg
            className={`w-7 h-7 ${isDragActive && !isDragReject ? "text-blue-500" : "text-gray-400"} ${isDragReject ? "text-red-500" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>

        {isDragReject ? (
          <p className="text-red-600 font-semibold">Unsupported file type</p>
        ) : isDragActive ? (
          <p className="text-blue-600 font-semibold">Drop label files or folder here</p>
        ) : (
          <>
            <div>
              <p className="text-gray-700 font-semibold">
                Drag & drop label images or a folder here
              </p>
              <p className="text-gray-500 text-sm mt-1">or click to choose</p>
            </div>
            <p className="text-xs text-gray-400">
              Supports JPG, PNG, PDF · Up to 20MB per file · Multiple files or a folder accepted
            </p>
          </>
        )}
      </div>
    </div>
  );
}
