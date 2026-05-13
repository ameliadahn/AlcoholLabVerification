"use client";

import { PanelUpload } from "@/lib/types";

interface LabelPreviewCardProps {
  panel: PanelUpload;
  onRemove: (id: string) => void;
  onClick?: (id: string) => void;
  isSelected?: boolean;
}

export default function LabelPreviewCard({
  panel,
  onRemove,
  onClick,
  isSelected,
}: LabelPreviewCardProps) {
  const { id, file, previewUrl, panelLabel } = panel;
  const isPdf = file.type === "application/pdf";

  return (
    <div
      onClick={() => onClick?.(id)}
      className={`
        relative rounded-xl border-2 overflow-hidden cursor-pointer transition-all duration-200
        ${isSelected ? "border-blue-500 shadow-lg shadow-blue-100" : "border-gray-200 hover:border-gray-300"}
        bg-white
      `}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(id);
        }}
        className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-gray-800/60 hover:bg-red-600 text-white flex items-center justify-center text-xs transition-colors"
        title="Remove"
      >
        ✕
      </button>

      <div className="aspect-[3/4] bg-gray-100 flex items-center justify-center overflow-hidden">
        {isPdf ? (
          <div className="flex flex-col items-center gap-2 text-gray-400">
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <span className="text-xs font-medium">PDF</span>
          </div>
        ) : (
          <img
            src={previewUrl}
            alt={file.name}
            className="w-full h-full object-contain"
          />
        )}
      </div>

      <div className="p-2 border-t border-gray-100 bg-gray-50">
        <p className="text-xs font-semibold text-blue-700 truncate">{panelLabel}</p>
        <p className="text-xs text-gray-600 truncate" title={file.name}>{file.name}</p>
        <p className="text-xs text-gray-400 mt-0.5">{(file.size / 1024).toFixed(0)} KB</p>
      </div>
    </div>
  );
}
