#!/usr/bin/env node
// Local test harness for the facilities handler. Invokes the *bundled* handler
// (build/lambda/facilities/index.mjs) against the local Docker PostGIS, so it exercises
// exactly what would be deployed. Run `npm run build:lambdas` first.
//
// Connects using PG* env vars; defaults below match the local Docker container
// (infra/local/docker-compose.yml), which is mapped to host port 5433.
//
// Usage:
//   node infra/lambda/facilities/run-local.mjs
//   PGPORT=5433 node infra/lambda/facilities/run-local.mjs

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Defaults for the local Docker DB — only set if not already provided by the caller.
process.env.PGHOST ??= "127.0.0.1";
process.env.PGPORT ??= "5433";
process.env.PGUSER ??= "postgres";
process.env.PGPASSWORD ??= "postgres";
process.env.PGDATABASE ??= "gis";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundlePath = resolve(__dirname, "..", "..", "build", "lambda", "facilities", "index.mjs");
const { handler, closePool } = await import(bundlePath);

async function invoke(label, event) {
  const res = await handler(event);
  console.log(`\n=== ${label} (status ${res.statusCode}) ===`);
  const body = JSON.parse(res.body);
  if (res.statusCode !== 200) {
    console.log(body);
    return;
  }
  console.log("area:", JSON.stringify(body.area));
  const byKind = {};
  for (const f of body.facilities) (byKind[f.kind] ??= []).push(f);
  for (const [kind, list] of Object.entries(byKind)) {
    console.log(`  ${kind}: ${list.length} 筆`);
    for (const f of list.slice(0, 3)) {
      console.log(`    - ${f.name ?? "(無名)"}  ${f.metersToCenter}m`);
    }
    if (list.length > 3) console.log(`    ... (+${list.length - 3})`);
  }
  console.log(`  門牌: ${body.doorplate.count} 筆 (最近 ${body.doorplate.nearest.length} 筆)`);
  for (const d of body.doorplate.nearest.slice(0, 3)) {
    console.log(`    - ${d.address}  ${d.metersToCenter}m`);
  }
}

// 1) center + radius: 板橋車站附近 500m。
await invoke("center+radius 板橋 500m (GET)", {
  requestContext: { http: { method: "GET" } },
  queryStringParameters: { lon: "121.4627", lat: "25.0111", radius: "500" },
});

// 2) polygon: 板橋車站周邊一塊約 ~1.5km 的方框 (POST GeoJSON polygon)。
await invoke("polygon 板橋方框 (POST)", {
  requestContext: { http: { method: "POST" } },
  body: JSON.stringify({
    polygon: {
      type: "Polygon",
      coordinates: [
        [
          [121.455, 25.005],
          [121.470, 25.005],
          [121.470, 25.018],
          [121.455, 25.018],
          [121.455, 25.005],
        ],
      ],
    },
  }),
});

// 3) bad input -> 400.
await invoke("invalid (no area)", {
  requestContext: { http: { method: "GET" } },
  queryStringParameters: {},
});

// Close the pg pool so the process can end instead of hanging on open sockets. Some
// bundled-pg builds still leave a lingering handle, so hard-exit afterwards — this is a
// throwaway test harness, so a forced exit is fine.
await closePool();
process.exit(0);
