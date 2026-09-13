// Local dev runner for image-upload (流程 G, 案件圖片上傳/列表). Stores/lists images in S3
// — NEEDS ASSET_BUCKET (+ optional S3_PREFIX, default "case-images") + AWS creds. No DB.
//
// Run:
//   cd infra
//   ASSET_BUCKET="ntland...-databucket..." S3_PREFIX="case-images" \
//   AWS_PROFILE=PROFILE AWS_REGION=ap-northeast-1 \
//     node --import ./scripts/register-ts.mjs lambda/image-upload/invoke-local.ts
//
// Routing (see handler header):
//   POST { caseId, fileName, contentType, dataBase64 }  -> PutObject -> { ok, s3Key }
//   GET  ?caseId=                                        -> list images -> { caseId, images }
//   GET  ?caseId=&fileName=                              -> GetObject -> 二進位圖片
//
// The example below lists images for a case (safe read). Switch EVENT to POST to upload.
//
// 注意:列表回傳的 `url` 由 event.requestContext.domainName 組出,本地沒有 Function URL
// domain,所以 local 跑出來的每一筆會沒有 url —— 這是預期的,部署後才會有。

import { getEvent, runLocal, type FunctionUrlEvent } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

// --- 列出某案圖片(預設,純讀)---
const EVENT: FunctionUrlEvent = getEvent({ caseId: "case_demo" });

// --- 下載單張(把上面 EVENT 換成這個;二進位會寫到 infra/tmp/image-upload.png)---
// getEvent({ caseId: "case_demo", fileName: "a.png" })

// --- 上傳範例(把上面 EVENT 換成這個)---
// postEvent({ caseId: "case_demo", fileName: "a.jpg", contentType: "image/jpeg",
//             dataBase64: "<圖片 base64>" })

await runLocal(handler, EVENT, "image-upload");
