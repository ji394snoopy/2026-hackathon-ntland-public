// Local dev runner for facilities (= GET /api/facilities). Queries PostGIS + merges live
// NLSC. Unlike the other DB lambdas, facilities has its OWN driver switch (FACILITIES_DB_DRIVER):
//
//   - Local PostGIS (Docker), no AWS needed:
//       docker compose -f local/docker-compose.yml up -d      # PostGIS on port 5433
//       cd infra
//       FACILITIES_DB_DRIVER=pg PGHOST=localhost PGPORT=5433 PGUSER=postgres \
//       PGPASSWORD=postgres PGDATABASE=gis \
//         node --import ./scripts/register-ts.mjs lambda/facilities/invoke-local.ts
//     (需先把 local/init + local/import 的表/資料灌進本機 PostGIS。)
//
//   - Cloud Aurora via Data API:
//       FACILITIES_DB_DRIVER=data-api \
//       DB_CLUSTER_ARN="..." DB_SECRET_ARN="..." DB_NAME="gis" \
//       AWS_PROFILE=PROFILE AWS_REGION=ap-northeast-1 \
//         node --import ./scripts/register-ts.mjs lambda/facilities/invoke-local.ts
//
// Endpoint: GET ?lon=&lat=&radius=  (or a polygon; see input.ts)。回範圍內設施 + 到中心距離
//   + 門牌數/最近幾筆 + 即時 NLSC 環域。includeNlsc 預設 true(要純本機可帶 &nlsc=0 視 handler 而定)。

import { getEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

const EXAMPLE = getEvent({ lon: 121.4627, lat: 25.0111, radius: 500 });

await runLocal(handler, EXAMPLE, "facilities");
