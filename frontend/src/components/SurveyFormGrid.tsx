import { Fragment, useState } from "react"
import StatusTag from "./StatusTag"
import { ReferenceDetails, ReferenceToggle } from "./ReferencePanel"
import type { SurveyField } from "../types"

// 對齊官方表1紙本版面的分區順序
export const GROUP_ORDER = [
  "土地使用管制",
  "交通運輸",
  "自然條件",
  "土地改良",
  "公共建設",
  "特殊設施",
  "環境污染",
  "工商活動",
  "房屋建築現況",
  "土地利用現況",
]

export default function SurveyFormGrid({
  fields,
  editable = false,
  onUpdateField,
  onConfirmField,
  onSelectFieldFacility,
  onExpandFieldFacility,
}: {
  fields: SurveyField[]
  editable?: boolean
  onUpdateField?: (key: string, value: string) => void
  onConfirmField?: (key: string) => void
  onSelectFieldFacility?: (key: string, facilityOptionKey: string) => void
  // 展開候選清單當下才呼叫一次，讓其餘候選補查步行距離（見 App.tsx expandSurveyFieldFacility）
  onExpandFieldFacility?: (key: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [facilityListExpanded, setFacilityListExpanded] = useState<Set<string>>(new Set())

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const toggleFacilityList = (key: string) => {
    setFacilityListExpanded((prev) => {
      const next = new Set(prev)
      const opening = !next.has(key)
      opening ? next.add(key) : next.delete(key)
      if (opening) onExpandFieldFacility?.(key)
      return next
    })
  }

  const groups = GROUP_ORDER.map((name) => ({
    name,
    fields: fields.filter((f) => f.group === name),
  })).filter((g) => g.fields.length > 0)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
      {groups.map((group) => (
        <div key={group.name} className="border border-[#D9DCE0] rounded-[4px] bg-white overflow-hidden self-start">
          <div className="px-2.5 py-1 bg-[#EDEFF2] border-b border-[#D9DCE0] text-[11px] font-semibold text-[#374151] tracking-wide">
            {group.name}
          </div>
          <table className="w-full border-collapse">
            <tbody>
              {group.fields.map((field) => (
                <Fragment key={field.key}>
                  <tr className="border-b border-[#EEF0F2] last:border-0">
                    <td className="align-top w-[38%] bg-[#FAFAFB] border-r border-[#EEF0F2] px-2 py-1.5 text-[11px] text-[#4B5563] leading-snug">
                      {field.label}
                    </td>
                    <td className="align-top px-2 py-1.5">
                      <div className="flex items-start gap-1.5">
                        <div className="flex-1 min-w-0 space-y-0.5">
                          {editable ? (
                            field.options && field.multi ? (
                              <div className="flex flex-wrap gap-x-3 gap-y-1">
                                {field.options.map((o) => {
                                  const selected = field.value
                                    .split("、")
                                    .map((v) => v.trim())
                                    .filter(Boolean)
                                  const checked = selected.includes(o)
                                  return (
                                    <label key={o} className="inline-flex items-center gap-1 text-[11px] text-[#1A1A1A]">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => {
                                          const next = checked
                                            ? selected.filter((v) => v !== o)
                                            : field.options!.filter((opt) => selected.includes(opt) || opt === o)
                                          onUpdateField?.(field.key, next.join("、"))
                                        }}
                                        className="accent-[#12457B]"
                                      />
                                      {o}
                                    </label>
                                  )
                                })}
                              </div>
                            ) : field.options ? (
                              <select
                                value={field.value}
                                onChange={(e) => onUpdateField?.(field.key, e.target.value)}
                                className="w-full border border-[#D9DCE0] rounded-[4px] px-1.5 py-0.5 text-[11px] bg-white text-[#1A1A1A] focus:outline-none focus:border-[#12457B]"
                              >
                                {!field.value && <option value="">— 請選擇 —</option>}
                                {field.options.map((o) => (
                                  <option key={o} value={o}>
                                    {o}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={field.value}
                                placeholder={field.source === "empty" ? "請填寫" : ""}
                                disabled={field.pending}
                                onChange={(e) => onUpdateField?.(field.key, e.target.value)}
                                className="w-full border border-[#D9DCE0] rounded-[4px] px-1.5 py-0.5 text-[11px] font-mono bg-white text-[#1A1A1A] focus:outline-none focus:border-[#12457B] placeholder:text-[#D9DCE0] disabled:bg-[#F5F6F7] disabled:text-[#9CA3AF]"
                              />
                            )
                          ) : (
                            <div className="text-[11px] font-mono text-[#1A1A1A] py-0.5">
                              {field.value || <span className="text-[#B7BEC7]">—（待填）</span>}
                            </div>
                          )}
                          {field.pending && (
                            <div className="inline-flex items-center gap-1.5 text-[10px] text-[#12457B]">
                              <span className="inline-block w-2.5 h-2.5 border-[1.5px] border-[#12457B]/30 border-t-[#12457B] rounded-full animate-spin" />
                              步行距離查詢中…目前先顯示直線距離
                            </div>
                          )}
                          {field.source === "ai" && field.confidence === "low" && (
                            <div className="text-[10px] text-[#B7791F]">AI建議：{field.aiSuggestion}（信心度低，請確認）</div>
                          )}
                          {field.warning && (
                            <div className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-[2px] w-fit">
                              ⚠ {field.warning}
                            </div>
                          )}
                          {field.source !== "prefilled" && (
                            <div className="text-[10px] text-[#9CA3AF]">{field.origin}</div>
                          )}
                          {editable &&
                            !field.pending &&
                            field.facilityOptions &&
                            field.facilityOptions.length > 1 && (
                              <div>
                                <button
                                  onClick={() => toggleFacilityList(field.key)}
                                  className="text-[10px] text-[#12457B] hover:underline"
                                >
                                  {facilityListExpanded.has(field.key) ? "收起候選設施" : "查看其他候選設施"}
                                  （共{field.facilityOptions.length}筆）
                                </button>
                                {facilityListExpanded.has(field.key) && (
                                  <div className="mt-1 space-y-1 border border-[#D9DCE0] rounded-[4px] p-1.5 bg-[#FAFAFB]">
                                    {field.facilityOptions.map((opt) => (
                                      <label
                                        key={opt.key}
                                        className="flex items-center gap-1.5 text-[11px] text-[#1A1A1A] cursor-pointer"
                                      >
                                        <input
                                          type="radio"
                                          name={`facility-${field.key}`}
                                          checked={field.selectedFacilityKey === opt.key}
                                          onChange={() =>
                                            onSelectFieldFacility?.(field.key, opt.key)
                                          }
                                          className="accent-[#12457B] shrink-0"
                                        />
                                        <span className="flex-1 truncate">{opt.name}</span>
                                        <span className="text-[#6B7280] font-mono text-[10px] shrink-0">
                                          {opt.insideBoundary === true
                                            ? "本區段內"
                                            : `距${opt.metersToCenter}m${opt.walked ? "（步行）" : ""}`}
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {field.source !== "prefilled" && <StatusTag source={field.source} />}
                          <div className="flex items-center gap-1.5">
                            {field.source !== "prefilled" && (
                              <ReferenceToggle
                                expanded={expanded.has(field.key)}
                                onToggle={() => toggleExpand(field.key)}
                                hasReference={!!field.reference}
                              />
                            )}
                            {editable &&
                              field.source !== "confirmed" &&
                              field.source !== "prefilled" &&
                              field.value && (
                                <button
                                  onClick={() => onConfirmField?.(field.key)}
                                  className="text-[10px] text-[#2E7D32] hover:underline shrink-0"
                                >
                                  確認
                                </button>
                              )}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                  {expanded.has(field.key) && field.reference && (
                    <tr className="border-b border-[#EEF0F2] last:border-0">
                      <td colSpan={2} className="p-0">
                        <ReferenceDetails reference={field.reference} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
