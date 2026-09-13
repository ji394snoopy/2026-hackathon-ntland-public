// 自由字串 → (縣市, 行政區, 段名, 地號) 的寬鬆解析,支援 land-locate 的 `?q=` 路由。
//
// 沿用 docs/hackathon實作初始定位.md §S1 的 PARCEL regex 骨架(county / town / section /
// sub / no / subNo),放寬三處讓它更耐用:
//   1. 地號可省略 → 只給「區 + 段」也能解析,回段中心點。
//   2. 結尾的「地號」兩字可省略。
//   3. 子號分隔符接受 '-' / '之' / en dash / em dash / 全形減號(交給 normalizeParcelId 收斂)。
//
// 已知限制:regex 以「段」字錨定,所以 1500 三峽鎮 / 1600 鶯歌鎮 / 1700 樹林市 這類
// 舊制段名(plan §9.5,照原樣存在 DB 不正規化)無法用 `?q=` 查 —— 它們會被前面的
// 「行政區」群組吃掉。這類請改用明確的 ?district=&section= 或 ?sectno=。

import { normalizeParcelId, normalizeSectionName } from "./parcelId";

export interface FreeTextQuery {
  county?: string;
  district?: string;
  /** 段名(含小段,連寫),對齊 land_section.section / land_transaction.segment 的格式。 */
  section?: string;
  /** 地號原文(未正規化);呼叫端再丟 normalizeParcelId。無地號時 undefined。 */
  lid?: string;
}

// county:2 字 + 市/縣(新北市 / 宜蘭縣)。district:1~3 字 + 鄉鎮市區(樹林區 / 三峽區)。
// section:非貪婪吃到第一個「段」,後面可再接一段「…小段」,兩者連寫成 DB 的 section。
// lid:數字(可帶子號),結尾的「地號」可有可無。
const PARCEL_RE =
  /^(?<county>[^\s]{2}[市縣])?(?<district>[^\s]{1,3}[鄉鎮市區])?(?<section>[^\s]*?段(?:[^\s]*?小段)?)(?<lid>\d+(?:-\d+)?)?地?號?$/;

/** 全形數字 → 半角、各種子號分隔符 → '-'、去掉所有空白。 */
function clean(raw: string): string {
  return raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/[之–—－_]/g, "-")
    .replace(/[\s　]/g, "");
}

/**
 * 解析自由字串。解析不出「段」時回 null(呼叫端回 400 並提示改用明確參數)。
 *
 * 例:
 *   '新北市樹林區大同段31-1地號' → { county:'新北市', district:'樹林區', section:'大同段', lid:'31-1' }
 *   '樹林區大同段'               → { district:'樹林區', section:'大同段' }
 *   '石碇區小格頭段十三股小段5'   → { district:'石碇區', section:'小格頭段十三股小段', lid:'5' }
 */
export function parseFreeText(raw: string | null | undefined): FreeTextQuery | null {
  if (!raw) return null;
  const m = PARCEL_RE.exec(clean(raw));
  if (!m?.groups) return null;

  const section = normalizeSectionName(m.groups.section);
  if (!section) return null;

  const out: FreeTextQuery = { section };
  if (m.groups.county) out.county = m.groups.county;
  if (m.groups.district) out.district = m.groups.district;
  // 地號原文照樣帶出去;是否合法由 normalizeParcelId 判(這裡只確認它解析得動)。
  if (m.groups.lid && normalizeParcelId(m.groups.lid)) out.lid = m.groups.lid;
  return out;
}
