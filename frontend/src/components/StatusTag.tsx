import type { FieldSource } from "../types"

const MAP: Record<FieldSource, [string, string]> = {
  ai: ["AI已填", "bg-[#12457B] text-white"],
  empty: ["需人工填", "bg-[#E5E7EB] text-[#6B7280]"],
  manual: ["人工已填", "bg-[#DDE3EA] text-[#374151]"],
  prefilled: ["預填值", "bg-[#EEF2F6] text-[#4B5563]"],
  edited: ["已修改", "bg-amber-50 text-[#B7791F] border border-amber-300"],
  confirmed: ["已確認", "bg-green-50 text-[#2E7D32] border border-green-300"],
}

export default function StatusTag({ source }: { source: FieldSource }) {
  const [label, cls] = MAP[source]
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-[2px] whitespace-nowrap ${cls}`}
    >
      {label}
    </span>
  )
}
