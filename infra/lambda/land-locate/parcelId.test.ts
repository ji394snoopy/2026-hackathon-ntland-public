// land-locate 的純函式單元測試:地號正規化 + 段代碼補零 + 自由字串解析。
// 執行:npm run test:land-locate(見 infra/package.json;走 esbuild ts-loader)。
//
// 這裡在防的是 plan §2.4 那個坑:同一筆地號在三張表有三種寫法
//   land_parcel/land_transaction → '31-1'(無前導零)、land_official_value → '0489'(補零)
// 所以查詢一律拆成 (master_no, sub_no) 兩個整數比對;測試把各種輸入寫法釘死。

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseFreeText } from "./freeText";
import { normalizeParcelId, normalizeSectionName, normalizeSectno } from "./parcelId";

test("normalizeParcelId:母號 + 子號的各種分隔符都收斂成同一對整數", () => {
  for (const input of ["31-1", "31之1", "31–1", "31—1", "31－1", "31_1", " 31-1 地號 "]) {
    assert.deepEqual(
      normalizeParcelId(input),
      { masterNo: 31, subNo: 1, canonical: "31-1" },
      `input=${input}`,
    );
  }
});

test("normalizeParcelId:前導零被吃掉(land_official_value 的 '0489' 對得上 '489')", () => {
  assert.deepEqual(normalizeParcelId("0031-0001"), {
    masterNo: 31,
    subNo: 1,
    canonical: "31-1",
  });
  assert.deepEqual(normalizeParcelId("0489"), {
    masterNo: 489,
    subNo: 0,
    canonical: "489",
  });
});

test("normalizeParcelId:只有母號 → subNo 0(不是 null,要能進複合索引)", () => {
  assert.deepEqual(normalizeParcelId("169"), {
    masterNo: 169,
    subNo: 0,
    canonical: "169",
  });
});

test("normalizeParcelId:全形數字轉半角", () => {
  assert.deepEqual(normalizeParcelId("３１之１"), {
    masterNo: 31,
    subNo: 1,
    canonical: "31-1",
  });
  assert.deepEqual(normalizeParcelId("４８９"), {
    masterNo: 489,
    subNo: 0,
    canonical: "489",
  });
});

test("normalizeParcelId:子號 0 與無子號視為同一筆('31-0' → '31')", () => {
  assert.deepEqual(normalizeParcelId("31-0"), {
    masterNo: 31,
    subNo: 0,
    canonical: "31",
  });
});

test("normalizeParcelId:解析不出來回 null,不丟例外", () => {
  for (const bad of ["", "  ", "abc", "31-", "-1", "31-1-2", "三一", null, undefined]) {
    assert.equal(normalizeParcelId(bad as string), null, `input=${String(bad)}`);
  }
});

test("normalizeSectno:對照表的未補零代碼補成 KML 的 4 碼", () => {
  assert.equal(normalizeSectno("106"), "0106");
  assert.equal(normalizeSectno("1904"), "1904");
  assert.equal(normalizeSectno("50"), "0050");
  assert.equal(normalizeSectno("0106"), "0106");
  assert.equal(normalizeSectno("１９０４"), "1904");
  assert.equal(normalizeSectno(""), null);
  assert.equal(normalizeSectno(null), null);
});

test("normalizeSectionName:只去空白,舊制段名不被改寫", () => {
  assert.equal(normalizeSectionName(" 大同段 "), "大同段");
  assert.equal(normalizeSectionName("石灰坑段 石灰坑小段"), "石灰坑段石灰坑小段");
  // plan §9.5:'三峽鎮'/'鶯歌鎮'/'樹林市' 是段名本體,不能正規化成 '三峽段'。
  assert.equal(normalizeSectionName("三峽鎮"), "三峽鎮");
  assert.equal(normalizeSectionName("樹林市"), "樹林市");
});

test("parseFreeText:縣市 + 區 + 段 + 地號 全給", () => {
  assert.deepEqual(parseFreeText("新北市樹林區大同段31-1地號"), {
    county: "新北市",
    district: "樹林區",
    section: "大同段",
    lid: "31-1",
  });
});

test("parseFreeText:省略縣市 / 省略「地號」兩字", () => {
  assert.deepEqual(parseFreeText("樹林區大同段31-1"), {
    district: "樹林區",
    section: "大同段",
    lid: "31-1",
  });
});

test("parseFreeText:小段與段名連寫成 DB 的 section 格式", () => {
  assert.deepEqual(parseFreeText("石碇區小格頭段十三股小段5地號"), {
    district: "石碇區",
    section: "小格頭段十三股小段",
    lid: "5",
  });
});

test("parseFreeText:沒有地號 → 只回段,走段中心點", () => {
  assert.deepEqual(parseFreeText("樹林區大同段"), {
    district: "樹林區",
    section: "大同段",
  });
});

test("parseFreeText:全形數字與『之』在自由字串裡一樣吃得下", () => {
  assert.deepEqual(parseFreeText("樹林區大同段３１之１地號"), {
    district: "樹林區",
    section: "大同段",
    lid: "31-1",
  });
});

test("parseFreeText:解析不出『段』回 null(舊制段名的已知限制)", () => {
  assert.equal(parseFreeText(""), null);
  assert.equal(parseFreeText(null), null);
  assert.equal(parseFreeText("樹林區"), null);
  // 三峽鎮 會被「行政區」群組吃掉又沒有『段』→ null,呼叫端提示改用 ?district=&section=。
  assert.equal(parseFreeText("三峽鎮5地號"), null);
});
