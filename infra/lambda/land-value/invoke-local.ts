// Local dev runner for land-value (= GET /api/land/value). Reads the shared DB layer
// (Drizzle over RDS Data API) — NEEDS DB env + AWS creds. Pure read, no S3.
//
// Run:
//   cd infra
//   DB_CLUSTER_ARN="arn:aws:rds:...:cluster:..." \
//   DB_SECRET_ARN="arn:aws:secretsmanager:...:secret:..." \
//   DB_NAME="gis" AWS_PROFILE=PROFILE AWS_REGION=ap-northeast-1 \
//     node --import ./scripts/register-ts.mjs lambda/land-value/invoke-local.ts
//   (ARNs 見 local-deploy-steps.txt NtlandDatabaseStack。)
//
// Endpoint: GET ?district=&segment=&lid=
//   segment + lid 必填;district 選填(同名段跨區消歧義)。找不到 -> 404;只有一年 -> growth null。

import { getEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

const EXAMPLE = getEvent({ district: "新北市金山區", segment: "金美段", lid: "0489" });

await runLocal(handler, EXAMPLE, "land-value");
