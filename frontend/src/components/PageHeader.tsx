export default function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-5 py-3 bg-white border-b border-[#D9DCE0] shrink-0">
      <h1 className="text-sm font-semibold text-[#1A1A1A]">{title}</h1>
      {subtitle && <p className="text-[11px] text-[#6B7280] mt-0.5">{subtitle}</p>}
    </div>
  )
}
