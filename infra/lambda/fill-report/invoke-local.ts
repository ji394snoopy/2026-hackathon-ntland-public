// Local dev runner for fill-report (流程 H PDF 合併器). Pure pdf-lib, no AWS / DB / env.
// 收 { files: [{ name?, pdfBase64 }] } 依序合併成單一 PDF -> 寫到 tmp/fill-report.pdf。
//
// Run:
//   cd infra
//   node --import ./scripts/register-ts.mjs lambda/fill-report/invoke-local.ts
//   open tmp/fill-report.pdf
//
// Endpoint: POST { files: [{ name?, pdfBase64 }] }(相容裸陣列 / 單筆 { pdfBase64 })。
//
// 這支需要「已是 PDF」的 base64 當輸入。此範例先用 fill-district-survey 產一份 PDF(免 AWS),
// 再把它當兩個 part 丟給 fill-report 合併,證明合併流程可跑。要合真的多段就換成你自己的 base64。

import { postEvent, runLocal } from "../shared/invokeLocal.js";
import { handler as fillDistrictSurvey } from "../fill-district-survey/lambda.js";
import { handler } from "./lambda.js";

// 先產一份表1 PDF 當素材(fill-district-survey 純 pdf-lib,免憑證)。
const survey = await fillDistrictSurvey({
  requestContext: { http: { method: "POST" } },
  body: JSON.stringify({ meta: { sectionId: "P002-00" } }),
});
const pdfBase64 = survey.body; // isBase64Encoded PDF

const EXAMPLE = {
  files: [
    { name: "part-1", pdfBase64 },
    { name: "part-2", pdfBase64 },
  ],
};

await runLocal(handler, postEvent(EXAMPLE), "fill-report");
