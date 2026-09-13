// Local dev runner for factor-standard-store (基準表數位化結果的儲存/重用). Uses the shared
// DB layer (Drizzle over RDS Data API) for the factor_standard table + S3 for the source PDF
// — NEEDS DB env + ASSET_BUCKET + AWS creds.
//
// Run:
//   cd infra
//   DB_CLUSTER_ARN="..." DB_SECRET_ARN="..." DB_NAME="gis" \
//   ASSET_BUCKET="ntland...-databucket..." \
//   AWS_PROFILE=PROFILE AWS_REGION=ap-northeast-1 \
//     node --import ./scripts/register-ts.mjs lambda/factor-standard-store/invoke-local.ts
//   (前置:factor_standard 表 DDL 見 local-deploy-steps.txt。)
//
// Routing (see handler header):
//   POST { fileName, extracted, label?, pdfBase64?, s3Key? }  -> store one (version auto-increments)
//   GET ?id= | ?fileName=(&version=)                          -> get one (含 extracted)
//   GET ?label= | ?fileName=&list=1 | (no params)             -> list (lightweight metadata)
//
// The example below lists all stored records (safe read). Switch EVENT to POST to store one
// (extracted = factor-standard-extract 的輸出;pdfBase64 = 原始 PDF).

import { getEvent, runLocal, type FunctionUrlEvent } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

// --- 列表(預設,純讀)---
const EVENT: FunctionUrlEvent = getEvent({});

// --- 存一筆範例(把上面 EVENT 換成這個)---
// postEvent({ fileName: "factor-standard.pdf", label: "2026 範例",
//             extracted: { /* factor-standard-extract 的輸出 */ },
//             pdfBase64: "<原始 PDF base64>" })

await runLocal(handler, EVENT, "factor-standard-store");
