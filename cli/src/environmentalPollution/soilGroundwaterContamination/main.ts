process.loadEnvFile();

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMoenvApiKey, queryMoenvDatasetPaginated } from "../moenvClient.js";
import { findNearestPoint } from "../nearestPoint.js";
import { parseContaminationSites } from "./parseSites.js";

const OUTPUT_DIR = "./src/environmentalPollution/soilGroundwaterContamination/output";
const SITES_DATASET = "ems_s_07";
// Confirmed live: this dataset has 2000+ sites, over the API's 1000-row-per-request
// cap, so a single queryMoenvDataset call silently truncates it — must paginate.
const MAX_PAGES = 10;

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
  console.log(`Fetching ${SITES_DATASET} (nationwide soil/groundwater contamination sites)...`);
  const records = await queryMoenvDatasetPaginated(SITES_DATASET, apiKey, {}, MAX_PAGES);
  const sites = parseContaminationSites(records);

  const nearest = findNearestPoint(
    sites.map((s) => ({ lon: s.lon, lat: s.lat, record: s })),
    lon,
    lat,
  );

  const output = { center: { lon, lat }, nearestSite: nearest };

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
