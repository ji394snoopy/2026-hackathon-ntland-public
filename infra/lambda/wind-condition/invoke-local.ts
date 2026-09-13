// Local dev runner for wind-condition. No AWS creds / no DB — pure Open-Meteo call.
//
// Run:
//   cd infra
//   node --import ./scripts/register-ts.mjs lambda/wind-condition/invoke-local.ts
//
// Endpoint: GET ?lon=<lon>&lat=<lat>
//   回近一年「每日最大風速」平均 + 主風向(度數 + 羅盤方位)。全球可查。
//   改座標就改下面的 EXAMPLE。

import { getEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

// 板橋, 新北市。想試別的點就改這裡。
const EXAMPLE = getEvent({ lon: 121.4627, lat: 25.0111 });

await runLocal(handler, EXAMPLE, "wind-condition");
