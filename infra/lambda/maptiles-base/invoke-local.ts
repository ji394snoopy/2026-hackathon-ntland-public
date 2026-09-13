// Local dev runner for maptiles-base (1/5000 基本地形圖 B5000). No AWS creds / no DB.
// Fetches + stitches NLSC WMTS tiles into a PNG. The base64 PNG response is written to
// infra/tmp/maptiles-base.png so you can open it.
//
// Run:
//   cd infra
//   node --import ./scripts/register-ts.mjs lambda/maptiles-base/invoke-local.ts
//   open tmp/maptiles-base.png
//
// Endpoint: GET ?lon=&lat=&zoom=&radius=&pin=&emap=
//   lon/lat   必填座標
//   zoom      整數 [0,19],預設 15
//   radius    整數 [0,4](每 +1 是 (2r+1)^2 張圖磚),預設 0
//   pin       0/false/off/no 關閉中心標記,預設開
//   emap      white(白底,預設) / off / 其他值走 emap 底圖

import { getEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

const EXAMPLE = getEvent({ lon: 121.636, lat: 25.221, radius: 3 });

await runLocal(handler, EXAMPLE, "maptiles-base");
