// Local dev runner for land-locate (= GET /api/land/locate). Reads the shared DB layer
// (Drizzle over RDS Data API) — NEEDS DB env + AWS creds. Pure read, no S3.
//
// Run:
//   cd infra
//   DB_CLUSTER_ARN="arn:aws:rds:...:cluster:..." \
//   DB_SECRET_ARN="arn:aws:secretsmanager:...:secret:..." \
//   DB_NAME="gis" AWS_PROFILE=PROFILE AWS_REGION=ap-northeast-1 \
//     node --import ./scripts/register-ts.mjs lambda/land-locate/invoke-local.ts
//   (ARNs 見 local-deploy-steps.txt NtlandDatabaseStack。)
//
// 四個範例分別打三種路由 + 三層 fallback。切換:CASE=parcel|private|no-geometry|free
//
// ⚠️ 資料是公有土地子集,私有地地號一定查不到(會退段中心點)。要挑會命中的地號:
//   SELECT district, section, parcelno FROM land_parcel WHERE district='樹林區' LIMIT 20;

import { getEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

const CASES = {
  // 宗地級命中(公有地):f_1902.kml 的 31-1,樹林區樹德段。
  parcel: getEvent({ district: "樹林區", section: "樹德段", lid: "31-1" }),
  // 私有地地號 → 退段中心點,precision:"section" + note。
  private: getEvent({ district: "樹林區", section: "樹德段", lid: "99999" }),
  // 段存在於對照表但沒有任何公有地幾何 → 404 + sectionExists:true。
  "no-geometry": getEvent({ sectno: "1700" }),
  // 自由字串路由。
  free: getEvent({ q: "樹林區樹德段31-1地號" }),
} as const;

const which = (process.env.CASE ?? "parcel") as keyof typeof CASES;
const event = CASES[which];
if (!event) throw new Error(`Unknown CASE=${which}. Use one of: ${Object.keys(CASES).join(" | ")}`);

console.log(`[land-locate] CASE=${which} query=`, event.queryStringParameters);
await runLocal(handler, event, "land-locate");
