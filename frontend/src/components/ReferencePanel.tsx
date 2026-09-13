import type { FieldReference } from "../types";

export function ReferenceToggle({
  expanded,
  onToggle,
  hasReference,
}: {
  expanded: boolean;
  onToggle: () => void;
  hasReference: boolean;
}) {
  if (!hasReference) {
    return (
      <span className="text-[10px] text-[#9CA3AF]">需人工填，無 AI 依據</span>
    );
  }
  return (
    <button
      onClick={onToggle}
      className="inline-flex items-center gap-0.5 text-[10px] text-[#12457B] hover:underline shrink-0"
    >
      {expanded ? "收起" : "ⓘ 對照"}
    </button>
  );
}

const ROWS: { key: keyof FieldReference; label: string }[] = [
  { key: "dataSource", label: "數據來源" },
  { key: "measurement", label: "量測方式" },
  { key: "bracket", label: "依據級距" },
  { key: "derivation", label: "推導結果" },
  { key: "rawFact", label: "原始事實" },
];

export function ReferenceDetails({
  reference,
  warning,
}: {
  reference: FieldReference;
  warning?: string;
}) {
  return (
    <div className="px-4 py-2.5 bg-[#EEF4FB]">
      <div className="text-[10px] font-semibold text-[#12457B] mb-1.5">
        對照（可稽核依據）
      </div>
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1">
        {ROWS.filter((r) => reference[r.key]).map((r) => (
          <div key={r.key} className="contents">
            <dt className="text-[10px] text-[#6B7280]">{r.label}</dt>
            <dd className="text-[11px] text-[#374151]">{reference[r.key]}</dd>
          </div>
        ))}
      </dl>
      {warning && (
        <div className="mt-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-[2px] w-fit">
          ⚠ {warning}
        </div>
      )}
    </div>
  );
}
