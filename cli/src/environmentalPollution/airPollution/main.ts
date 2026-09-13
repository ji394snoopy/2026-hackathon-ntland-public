process.loadEnvFile();

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMoenvApiKey, queryMoenvDataset } from "../moenvClient.js";
import { findNearestPoint } from "../nearestPoint.js";
import { parseAqiStations } from "./parseStations.js";

const OUTPUT_DIR = "./src/environmentalPollution/airPollution/output";
const AQI_DATASET = "aqx_p_432";
const FETCH_LIMIT = 2000;

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
  console.log(`Fetching ${AQI_DATASET} (nationwide AQI stations)...`);
  const records = await queryMoenvDataset(AQI_DATASET, apiKey, { limit: FETCH_LIMIT });
  const stations = parseAqiStations(records);

  const nearest = findNearestPoint(
    stations.map((s) => ({ lon: s.lon, lat: s.lat, record: s })),
    lon,
    lat,
  );

  const output = { center: { lon, lat }, nearestStation: nearest };

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
