process.loadEnvFile();

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMoenvApiKey, queryMoenvDataset, queryMoenvDatasetPaginated } from "../moenvClient.js";
import { findNearestPoint } from "../nearestPoint.js";
import { parseWaterStations } from "./parseStations.js";
import { pickLatestReadingForSite } from "./parseReadings.js";

const OUTPUT_DIR = "./src/environmentalPollution/waterPollution/output";
const STATIONS_DATASET = "WQX_P_06";
const READINGS_DATASET = "WQX_P_01";
const STATIONS_FETCH_LIMIT = 1000;
// WQX_P_01 has no working siteid filter (confirmed live — siteid/itemname query params
// are silently ignored) and the API caps each request at 1000 rows regardless of the
// requested limit, so this module paginates a recent-sorted window and filters
// client-side — see parseReadings.ts. Confirmed live: a single 1000-row page only
// covers ~4 days and ~31 of the 446 stations (sampling frequency varies per station),
// so 30 pages (30,000 rows, ~2-3 months of coverage) is used to reasonably cover most
// stations' latest reading. A station still not sampled recently enough to appear in
// that window reports readingUnavailableInFetchedWindow, not silently hidden as "no
// data at all".
const READINGS_MAX_PAGES = 30;

function parseCoordinates(lonArg?: string, latArg?: string): { lon: number; lat: number } {
  const lon = Number(lonArg);
  const lat = Number(latArg);
  if (!lonArg || !latArg || Number.isNaN(lon) || Number.isNaN(lat)) {
    throw new Error("Usage: main.ts <lon> <lat>. Example: main.ts 121.636 25.221");
  }
  return { lon, lat };
}

async function main() {
  const [, , lonArg, latArg] = process.argv;
  const { lon, lat } = parseCoordinates(lonArg, latArg);

  const apiKey = readMoenvApiKey();

  console.log(`Fetching ${STATIONS_DATASET} (nationwide river water-quality stations)...`);
  const stationRecords = await queryMoenvDataset(STATIONS_DATASET, apiKey, { limit: STATIONS_FETCH_LIMIT });
  const stations = parseWaterStations(stationRecords);

  const nearest = findNearestPoint(
    stations.map((s) => ({ lon: s.lon, lat: s.lat, record: s })),
    lon,
    lat,
  );

  let latestReading = null;
  let readingUnavailableInFetchedWindow = false;
  if (nearest) {
    console.log(`Fetching ${READINGS_DATASET} (recent measurements, sorted by date desc, paginated)...`);
    const readingRecords = await queryMoenvDatasetPaginated(
      READINGS_DATASET,
      apiKey,
      { sort: "sampledate desc" },
      READINGS_MAX_PAGES,
    );
    latestReading = pickLatestReadingForSite(readingRecords, nearest.record.siteid);
    readingUnavailableInFetchedWindow = latestReading === null;
  }

  const output = { center: { lon, lat }, nearestStation: nearest, latestReading, readingUnavailableInFetchedWindow };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = `${OUTPUT_DIR}/result.json`;
  writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(JSON.stringify(output, null, 2));
  console.log(`Wrote ${outputPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { parseCoordinates };
