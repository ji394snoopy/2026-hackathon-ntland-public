// 地號正規化 — 把使用者/上游各種寫法的「地號」收斂成 (母號, 子號) 一對整數。
//
// 為什麼要拆成整數而不是比字串:repo 裡三張表的地號格式並不一致(見
// infra/docs/land-locate-plan.md §2.4):
//   - KML(land_parcel.parcelno)/ land_transaction.lid  →  '31-1'、'169'(無前導零)
//   - land_official_value.lid                          →  '0489'(補零)
// 字串比對會在「0489 vs 489」這種地方無聲 miss,所以 land-locate 一律用
// land_parcel.master_no / sub_no 兩個 integer 欄位查,前導零與分隔符寫法都被吸收掉。
//
// 無子號 → subNo = 0(DB 端 sub_no 的 DEFAULT 也是 0,不是 NULL,才能進複合索引)。

/** 正規化結果。canonical 是回給前端顯示用的標準寫法('31-1' / '169')。 */
export interface ParcelId {
  masterNo: number;
  subNo: number;
  canonical: string;
}

/** 全形數字 ０-９ (U+FF10~U+FF19) → 半角。其餘字元原樣留著。 */
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30),
  );
}

/**
 * 把一個地號字串正規化成 { masterNo, subNo, canonical }。
 *
 * 吸收的寫法:
 *   '31-1' / '31之1' / '31–1'(en dash)/ '31—1'(em dash)/ '31－1'(全形)/ '31_1'
 *   '0031-0001'(前導零)/ '0489' / '３１之１'(全形數字)/ ' 31-1 地號 '(贅字與空白)
 *
 * 解析不出母號時回 null(呼叫端自行決定要不要丟 400),不丟例外。
 */
export function normalizeParcelId(raw: string | null | undefined): ParcelId | null {
  if (raw === null || raw === undefined) return null;

  const cleaned = toHalfWidthDigits(String(raw))
    // 各種「子號分隔符」統一成 '-':之 / en dash / em dash / 全形減號 / 底線。
    .replace(/[之–—－_]/g, "-")
    // 「地號」「號」這類贅字與所有空白(含全形空白)去掉。
    .replace(/地號|號/g, "")
    .replace(/[\s　]/g, "");

  // 只接受「數字」或「數字-數字」;其他一律視為解析失敗(交給呼叫端回 400)。
  const m = /^(\d+)(?:-(\d+))?$/.exec(cleaned);
  if (!m) return null;

  // parseInt 順手吃掉前導零:'0031' → 31、'0489' → 489。
  const masterNo = Number.parseInt(m[1], 10);
  const subNo = m[2] === undefined ? 0 : Number.parseInt(m[2], 10);
  if (!Number.isFinite(masterNo) || !Number.isFinite(subNo)) return null;

  return {
    masterNo,
    subNo,
    canonical: subNo === 0 ? String(masterNo) : `${masterNo}-${subNo}`,
  };
}

/**
 * 段代碼正規化:對照表存的是未補零的 106 / 1904,KML 與 land_parcel.sectno 存的是
 * 補零 4 碼的 '0106' / '1904'。DB 端一律用補零 4 碼,所以入口先補齊。
 * 非純數字(或超過 4 位)原樣回傳,讓查詢自然 miss 而不是猜。
 */
export function normalizeSectno(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = toHalfWidthDigits(String(raw)).replace(/[\s　]/g, "");
  if (!s) return null;
  return /^\d{1,4}$/.test(s) ? s.padStart(4, "0") : s;
}

/**
 * 段名正規化:只去空白,不動「段 / 小段 / 鎮 / 市」等字樣。
 *
 * 刻意不把 '三峽鎮' / '鶯歌鎮' / '樹林市' 這類舊制段名正規化掉(plan §9.5):它們就是
 * 對照表裡的段名本體,改寫會查不到。「輸入少打一個『段』字」的容錯由 lambda 端的
 * 三段式比對(完全相等 → 補『段』→ 前綴 LIKE)處理,不在這裡改寫輸入。
 */
export function normalizeSectionName(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  return String(raw).replace(/[\s　]/g, "");
}
