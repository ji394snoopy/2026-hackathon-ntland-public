#!/usr/bin/env node
// Loads a GeoJSON FeatureCollection into a PostGIS table, without needing ogr2ogr on the
// host. Each dataset becomes one table with:
//   - id        bigserial primary key
//   - props     jsonb   (the feature's properties, kept as-is so schemas can differ
//                        freely between datasets without a migration per column)
//   - geom      geometry(Geometry, <srid>)   (LineString / Point / etc.)
//
// Strategy: stream feature rows as TSV (props-json <TAB> geometry-json) to stdout, which
// import.sh pipes into a staging table via `psql \copy`, then converts the text columns
// into real jsonb / geometry with ST_GeomFromGeoJSON. This keeps ~50k+ feature files
// (e.g. 國道路線) memory-friendly on the SQL side and avoids one INSERT per row.
//
// Usage: node load-geojson.mjs <input.geojson> [--srid=4326]
//   Emits TSV to stdout. Also prints, to stderr, the table-name suggestion + feature
//   count for the caller's logs.

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const [, , inputPath, ...rest] = process.argv;
if (!inputPath) {
  console.error("Usage: node load-geojson.mjs <input.geojson> [--srid=4326]");
  process.exit(1);
}

const sridArg = rest.find((a) => a.startsWith("--srid="));
const srid = sridArg ? Number(sridArg.split("=")[1]) : 4326;

const raw = readFileSync(inputPath, "utf8");
const json = JSON.parse(raw);
const features = Array.isArray(json) ? json : json.features ?? [];

// Emit CSV (tab-delimited) cells for psql's `\copy ... FORMAT csv, DELIMITER E'\t'`.
// CSV format (unlike text format) does NOT reinterpret backslash sequences and lets a
// double-quoted field contain tabs/newlines, with an internal " escaped as "". That
// sidesteps the pitfalls of COPY text mode (raw tabs/newlines inside JSON property
// strings, and backslash-escape mangling), so the stored value is byte-for-byte the
// JSON we produced here — valid for the later ::jsonb / ST_GeomFromGeoJSON cast.
function csvCell(value) {
  return '"' + JSON.stringify(value).replace(/"/g, '""') + '"';
}

let emitted = 0;
const out = [];
for (const feature of features) {
  const geometry = feature.geometry;
  if (!geometry) continue; // skip featureless rows (handled by the bus-stop loader instead)
  const props = feature.properties ?? {};
  out.push(`${csvCell(props)}\t${csvCell(geometry)}`);
  emitted++;
  // Flush in chunks to keep the output buffer bounded on very large files.
  if (out.length >= 5000) {
    process.stdout.write(out.join("\n") + "\n");
    out.length = 0;
  }
}
if (out.length > 0) process.stdout.write(out.join("\n") + "\n");

console.error(
  `${basename(inputPath)}: emitted ${emitted} feature row(s) (srid=${srid})`,
);
