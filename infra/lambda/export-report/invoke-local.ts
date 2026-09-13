// Local dev runner for export-report (= POST /api/export, 流程 H orchestrator).
//
// 對表1/表5/表4 各打對應填表 lambda(env FILL_DISTRICT_SURVEY_URL / FILL_REGIONAL_ANALYSIS_URL /
// FILL_INDIVIDUAL_ANALYSIS_URL)取 PDF、併前端附的地圖、向 image-upload(env IMAGE_UPLOAD_URL)
// 取回圖片轉頁,再丟 fill-report(env FILL_REPORT_URL)合併成單一 PDF。缺段跳過、完全無內容 400、
// 上游失敗 502。這些上游 URL 是「用到才需要」:只帶 survey 就只需 FILL_DISTRICT_SURVEY_URL + FILL_REPORT_URL。
//
// Run(至少設會用到的上游 + FILL_REPORT_URL;URL 見 local-deploy-steps.txt):
//   cd infra
//   FILL_DISTRICT_SURVEY_URL="https://<...>/" \
//   FILL_REPORT_URL="https://<...>/" \
//     node --import ./scripts/register-ts.mjs lambda/export-report/invoke-local.ts
//   open tmp/export-report.pdf
//
// Endpoint: POST { caseId?, surveys?[], survey?, regional?{purpose,content}, comparison?, maps?[{name?,pdfBase64}] }
//   surveys = 比準地 + 各比較標的的表1,依序各產一張;survey 為舊的單張寫法(兩者都帶以 surveys 為準)。
//   輸出:單一合併 base64 PDF -> 寫到 tmp/export-report.pdf。改要匯出的段就改 EXAMPLE。
//
// ⚠️ 這支 handler import 了 ../shared/db/mappers(目錄 import),register-ts 的 loader 解不了,
//    會噴 ERR_UNSUPPORTED_DIR_IMPORT。要本機跑請先 `npm --prefix infra run build:lambdas:only`,
//    改 import build/lambda/export-report/index.mjs 的 handler。

import { postEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

// 最小示例:只匯出表1(需 FILL_DISTRICT_SURVEY_URL + FILL_REPORT_URL)。
// 要多段就加 regional / comparison / maps。
const EXAMPLE = {
  survey: { meta: { sectionId: "P002-00" } },
};

await runLocal(handler, postEvent(EXAMPLE), "export-report");
