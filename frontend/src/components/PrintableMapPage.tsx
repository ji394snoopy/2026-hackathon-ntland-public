import type { ReactNode, RefObject } from "react"

// 三張圖籍（區段圖／使用分區圖／區段略圖）輸出用共用版面骨架：完全比照官方紙本圖說格式
// （置中標題／左上比例尺＋區段範圍圖例／置中地圖框／右下角圖例欄（僅使用分區圖）／右下角估價師簽署列）。
const KAI_FONT =
  "'標楷體-繁', 'DFKai-SB', 'BiauKai', 'Kaiti TC', 'STKaiti', 'Kaiti SC', '標楷體', 'KaiTi', serif"

export function PrintableMapPage({
  title,
  legendColor,
  legendLabel = "區段範圍",
  mapRef,
  sideLegend,
}: {
  title: string
  legendColor: string
  legendLabel?: string
  mapRef: RefObject<HTMLDivElement | null>
  sideLegend?: ReactNode
}) {
  return (
    <div
      id="print-root-map"
      className="w-[1180px] bg-white text-[#1A1A1A] p-[40px] border border-[#8A8F98]"
      style={{ fontFamily: KAI_FONT }}
    >
      <div className="text-center text-[22px] font-bold mb-[26px]">{title}</div>

      <div className="flex items-center gap-[10px] mb-[16px] text-[14px]">
        <span className="font-semibold">比例尺：1：1800</span>
        <span
          className="inline-block w-[38px] h-[20px] border-2"
          style={{ borderColor: legendColor }}
        />
        <span>{legendLabel}</span>
      </div>

      <div className="flex justify-center items-end gap-[20px]">
        <div
          className="relative border border-[#1A1A1A] bg-[#EAEAEA] overflow-hidden shrink-0"
          style={{ width: 700, height: 580 }}
        >
          <div ref={mapRef} className="w-full h-full" />
        </div>
        {sideLegend && <div className="w-[190px] shrink-0">{sideLegend}</div>}
      </div>

      <div className="flex justify-end mt-[18px] text-[14px]">
        <span>不動產估價師：</span>
      </div>
    </div>
  )
}

export function PrintableZoningLegend({
  items,
}: {
  items: { color: string; label: string }[]
}) {
  return (
    <div className="border border-[#1A1A1A] bg-white p-[10px]">
      <div className="text-[12px] font-semibold mb-[6px] pb-[4px] border-b border-[#D9DCE0]">
        圖例
      </div>
      <div className="space-y-[5px]">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-[6px]">
            <span
              className="inline-block w-[14px] h-[14px] shrink-0 border border-[rgba(0,0,0,0.25)]"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-[11px] leading-tight">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
