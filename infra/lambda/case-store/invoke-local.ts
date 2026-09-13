// Local dev runner for case-store (案件狀態儲存 CRUD). Uses the shared DB layer (Drizzle
// over RDS Data API) — NEEDS DB env + AWS creds. Writes/reads the appraisal_case + 三表.
//
// Run:
//   cd infra
//   DB_CLUSTER_ARN="arn:aws:rds:...:cluster:..." \
//   DB_SECRET_ARN="arn:aws:secretsmanager:...:secret:..." \
//   DB_NAME="gis" AWS_PROFILE=PROFILE AWS_REGION=ap-northeast-1 \
//     node --import ./scripts/register-ts.mjs lambda/case-store/invoke-local.ts
//
// Routing (see handler header):
//   POST (no ?form)            -> create a case ({ sectionId, meta? }) -> { caseId, ... }
//   PATCH ?caseId=             -> patch a case's sectionId / meta -> CaseSummary
//   PUT|POST ?form=survey            -> upsert 表3 定稿 ({ caseId, survey, benchmark })
//   PUT|POST ?form=regional-factors  -> upsert 表5 ({ caseId, regionalFactors, regionalTotal, remarks })
//   PUT|POST ?form=comparison        -> upsert 表4 ({ caseId, comparison, comparisonForm, computed })
//   PUT|POST ?form=comparison-survey -> upsert 一份比較標的表3 ({ caseId, targetIndex, survey, benchmark })
//   GET (no query)             -> list every case
//   GET ?caseId=               -> one case bundle
//   GET ?sectionId=            -> list a section's cases
//   GET ?form=survey|regional-factors|comparison&caseId= -> one 定稿 on its own
//   GET ?form=comparison-survey&caseId=[&targetIndex=]   -> a case's comparison surveys
//
// The example below creates a case. Change EVENT to exercise other routes (examples in comments).

import { postEvent, runLocal, type FunctionUrlEvent } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

// --- 建立案件(預設)---
const EVENT: FunctionUrlEvent = postEvent({ sectionId: "P002-00" });

// --- 其他路由範例(把上面 EVENT 換成想跑的)---
// 存表3:{ ...postEvent({ caseId: "case_...", survey: [], benchmark: {} }),
//         queryStringParameters: { form: "survey" } }
// 取單案:getEvent({ caseId: "case_..." })
// 列區段:getEvent({ sectionId: "P002-00" })
// 列全部:{ requestContext: { http: { method: "GET" } } }
// 改案件:{ ...postEvent({ sectionId: "P003-00" }),
//          requestContext: { http: { method: "PATCH" } },
//          queryStringParameters: { caseId: "case_..." } }
// 取表5:getEvent({ form: "regional-factors", caseId: "case_..." })
// 取單一比較標的:getEvent({ form: "comparison-survey", caseId: "case_...", targetIndex: 0 })

await runLocal(handler, EVENT, "case-store");
