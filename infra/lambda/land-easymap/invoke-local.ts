// Local dev runner for land-easymap (= GET /api/land/easymap)。
//
// 這支只打對外的公開網站(easymap.moi.gov.tw + api.nlsc.gov.tw),**不需要 AWS 憑證、
// 不需要 DB env** —— 有網路就能跑:
//
//   cd infra
//   node --import ./scripts/register-ts.mjs lambda/land-easymap/invoke-local.ts
//
// 切換範例:CASE=basic|sub|free|batch|unknown-section|unknown-parcel
// 想看每一次上游往返:EASYMAP_DEBUG=1 …
//
// ⚠️ 打的是真的政府網站,請不要短時間反覆跑(批次本身已經序列 + 間隔送)。

import { getEvent, postEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

const CASES = {
  // 原 CLI README 的範例:新北市金山區金美段 489 地號。
  basic: getEvent({ district: "金山區", section: "金美段", lid: "489" }),
  // 帶子號的寫法('之' / '-' 都吃)。
  sub: getEvent({ district: "樹林區", section: "樹德段", lid: "31-1" }),
  // 自由字串路由(沿用 land-locate 的解析器)。
  free: getEvent({ q: "金山區金美段489地號" }),
  // 批次(序列送,最多 EASYMAP_MAX_BATCH 筆)。
  batch: postEvent({
    parcels: [
      { district: "金山區", section: "金美段", lid: "489" },
      { district: "金山區", section: "金美段", lid: "490" },
    ],
  }),
  // NLSC 對照表查無此段 → 404。
  "unknown-section": getEvent({ district: "金山區", section: "不存在段", lid: "1" }),
  // 段存在但地號不存在 → 404(明細空 + 定位失敗)。
  "unknown-parcel": getEvent({ district: "金山區", section: "金美段", lid: "999999" }),
} as const;

const which = (process.env.CASE ?? "basic") as keyof typeof CASES;
const event = CASES[which];
if (!event) throw new Error(`Unknown CASE=${which}. Use one of: ${Object.keys(CASES).join(" | ")}`);

console.log(`[land-easymap] CASE=${which}`, event.queryStringParameters ?? event.body);
await runLocal(handler, event, "land-easymap");
