"use client";

import { ApplicationData } from "@/lib/types";

interface ApplicationFormProps {
  data: ApplicationData;
  onChange: (data: ApplicationData) => void;
  govWarnConfirmed: boolean;
  onGovWarnConfirmedChange: (v: boolean) => void;
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

const STANDARD_GOVERNMENT_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink " +
  "alcoholic beverages during pregnancy because of the risk of birth defects. " +
  "(2) Consumption of alcoholic beverages impairs your ability to drive a car or " +
  "operate machinery, and may cause health problems.";

export default function ApplicationForm({ data, onChange, govWarnConfirmed, onGovWarnConfirmedChange }: ApplicationFormProps) {
  const set = (field: keyof ApplicationData, value: string | boolean) =>
    onChange({ ...data, [field]: value });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Brand Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder='e.g. "OLD TOM DISTILLERY"'
            value={data.brandName}
            onChange={(e) => set("brandName", e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Class / Type Designation <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder='e.g. "Kentucky Straight Bourbon Whiskey"'
            value={data.classType}
            onChange={(e) => set("classType", e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Alcohol Content <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder='e.g. "45% Alc./Vol. (90 Proof)"'
            value={data.alcoholContent}
            onChange={(e) => set("alcoholContent", e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Net Contents <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder='e.g. "750 mL"'
            value={data.netContents}
            onChange={(e) => set("netContents", e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Bottler City <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder='e.g. "Miami"'
            value={data.bottlerCity}
            onChange={(e) => set("bottlerCity", e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Bottler State <span className="text-red-500">*</span>
          </label>
          <select
            value={data.bottlerState}
            onChange={(e) => set("bottlerState", e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
          >
            <option value="">Select state…</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Government Warning — confirmation checkbox */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Government Warning <span className="text-red-500">*</span>
        </label>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 leading-relaxed mb-3">
          {STANDARD_GOVERNMENT_WARNING}
        </div>
        <label
          className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors
            ${govWarnConfirmed
              ? "border-emerald-400 bg-emerald-50"
              : "border-gray-200 bg-white hover:border-gray-300"}`}
        >
          <input
            type="checkbox"
            checked={govWarnConfirmed}
            onChange={(e) => onGovWarnConfirmedChange(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span className={`text-sm font-medium ${govWarnConfirmed ? "text-emerald-800" : "text-gray-700"}`}>
            I confirm the government warning statement is present and legible on the label
          </span>
        </label>
      </div>

      <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <input
          type="checkbox"
          id="isImported"
          checked={data.isImported}
          onChange={(e) => set("isImported", e.target.checked)}
          className="mt-0.5 rounded border-gray-300 text-blue-600"
        />
        <div>
          <label htmlFor="isImported" className="block text-sm font-semibold text-gray-700 cursor-pointer">
            This is an imported product
          </label>
          <p className="text-xs text-gray-500 mt-0.5">
            Country of origin statement is required for imported products.
          </p>
        </div>
      </div>

      {data.isImported && (
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Country of Origin <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder='e.g. "Italy"'
            value={data.countryOfOrigin}
            onChange={(e) => set("countryOfOrigin", e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      )}
    </div>
  );
}
