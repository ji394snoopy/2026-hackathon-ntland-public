// Local dev runner for maptiles-detail (1/1000 都市計畫地形圖 TOPO01K, 新北市 only).
// No AWS creds / no DB. First call fetches + parses GetCapabilities (slower), then stitches
// the covering New Taipei sheet's tiles into a PNG, written to infra/tmp/maptiles-detail.png.
//
// Run:
//   cd infra
//   node --import ./scripts/register-ts.mjs lambda/maptiles-detail/invoke-local.ts
//   open tmp/maptiles-detail.png
//
// Endpoint: GET ?lon=&lat=&zoom=&radius=&pin=&emap=
//   僅支援新北市座標(點不在任何新北市 sheet 內回 404)。
//   zoom [0,19] 預設 15;radius [0,4] 預設 0;pin 預設開;emap white/off/emap。

import { getEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

const EXAMPLE = getEvent({ lon: 121.4627, lat: 25.0111, zoom: 15, radius: 1 });

await runLocal(handler, EXAMPLE, "maptiles-detail");
