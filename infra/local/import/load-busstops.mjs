#!/usr/bin/env node
// 公車站位資訊 is a plain JSON array (not GeoJSON): each item carries longitude/latitude
// as strings, in WGS84. This emits TSV rows (props-json <TAB> lon <TAB> lat) for
// import.sh to \copy into a staging table, which then builds a 4326 point via
// ST_SetSRID(ST_MakePoint(lon, lat), 4326).
//
// Usage: node load-busstops.mjs <input.json>   (emits TSV to stdout)

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const [, , inputPath] = process.argv;
if (!inputPath) {
  console.error("Usage: node load-busstops.mjs <input.json>");
  process.exit(1);
}

const items = JSON.parse(readFileSync(inputPath, "utf8"));
if (!Array.isArray(items)) {
  console.error("Expected a JSON array of bus-stop objects.");
  process.exit(1);
}

// Emit CSV (tab-delimited) cells for psql's `\copy ... FORMAT csv, DELIMITER E'\t'`.
// CSV format doesn't reinterpret backslash sequences and allows a double-quoted field
// to contain tabs/newlines (internal " escaped as ""), so bus-stop fields that contain
// a raw tab survive intact for the later ::jsonb cast.
function csvCell(value) {
  return '"' + JSON.stringify(value).replace(/"/g, '""') + '"';
}

let emitted = 0;
let skipped = 0;
const out = [];
for (const item of items) {
  const lon = Number(item.longitude);
  const lat = Number(item.latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    skipped++;
    continue;
  }
  out.push(`${csvCell(item)}\t${lon}\t${lat}`);
  emitted++;
  if (out.length >= 5000) {
    process.stdout.write(out.join("\n") + "\n");
    out.length = 0;
  }
}
if (out.length > 0) process.stdout.write(out.join("\n") + "\n");

console.error(
  `${basename(inputPath)}: emitted ${emitted} bus stop(s), skipped ${skipped} without coords`,
);
