// Local dev runner for land-transaction (= GET /api/land/transaction). Reads the shared DB
// layer (Drizzle over RDS Data API) — NEEDS DB env + AWS creds. Pure read, no S3.
//
// Run:
//   cd infra
//   DB_CLUSTER_ARN="arn:aws:rds:...:cluster:..." \
//   DB_SECRET_ARN="arn:aws:secretsmanager:...:secret:..." \
//   DB_NAME="gis" AWS_PROFILE=PROFILE AWS_REGION=ap-northeast-1 \
//     node --import ./scripts/register-ts.mjs lambda/land-transaction/invoke-local.ts
//
// Endpoint: GET ?district=&segment=[&kind=land|landhouse|all][&from=YYYY-MM-DD][&to=][&limit=]
//   segment 必填;kind 預設 landhouse(土地+房地,排除純車位);limit 預設 50、上限 200。

import { getEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

const EXAMPLE = getEvent({ district: "汐止區", segment: "北峰段", kind: "landhouse", limit: 20 });

await runLocal(handler, EXAMPLE, "land-transaction");
