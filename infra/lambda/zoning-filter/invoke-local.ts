// Local dev runner for zoning-filter (依 lat/lng 從 S3 的 zoning geojson 篩附近分區).
// Reads an 88MB geojson from S3 on cold start — NEEDS ZONING_DATA_BUCKET + ZONING_DATA_KEY
// + AWS creds. (This handler is plain JS: ./index.mjs, not a .ts.)
//
// Run:
//   cd infra
//   ZONING_DATA_BUCKET="ntland...-databucket..." \
//   ZONING_DATA_KEY="zoning/xxx.geojson" \
//   AWS_PROFILE=PROFILE AWS_REGION=ap-northeast-1 \
//     node --import ./scripts/register-ts.mjs lambda/zoning-filter/invoke-local.ts
//   (bucket/key = AssetStack dataBucket + zoningDataKey;見 CDK 輸出 / local-deploy-steps.txt。)
//
// Endpoint: GET ?lat=&lng=[&radius=]  radius 預設 1500m、上限 5000m。回 FeatureCollection。

import { getEvent, runLocal, type FunctionUrlEvent, type LambdaResponse } from "../shared/invokeLocal.js";
// zoning-filter/index.mjs is plain JS with no .d.ts, so tsc can't infer its handler type.
// @ts-expect-error — untyped JS module (esbuild/node resolve it fine at runtime)
import { handler as rawHandler } from "./index.mjs";

const handler = rawHandler as (event: FunctionUrlEvent) => Promise<LambdaResponse>;

const EXAMPLE = getEvent({ lat: 25.2219, lng: 121.63575, radius: 1500 });

await runLocal(handler, EXAMPLE, "zoning-filter");
