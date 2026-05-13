import { ValidationStatus } from "@/lib/types";

interface StatusBadgeProps {
  status: ValidationStatus;
  large?: boolean;
}

const config: Record<ValidationStatus, { label: string; className: string; icon: string }> = {
  pass: {
    label: "Pass",
    className: "bg-emerald-100 text-emerald-800 border border-emerald-300",
    icon: "✓",
  },
  fail: {
    label: "Fail",
    className: "bg-red-100 text-red-800 border border-red-300",
    icon: "✗",
  },
  review: {
    label: "Review Required",
    className: "bg-amber-100 text-amber-800 border border-amber-300",
    icon: "⚠",
  },
};

export default function StatusBadge({ status, large = false }: StatusBadgeProps) {
  const { label, className, icon } = config[status];
  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold rounded-full ${className} ${
        large ? "px-4 py-1.5 text-base" : "px-2.5 py-0.5 text-xs"
      }`}
    >
      <span>{icon}</span>
      {label}
    </span>
  );
}
