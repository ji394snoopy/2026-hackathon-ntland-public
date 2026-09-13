import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { downloadSoilMap } from "./downloadSoilMap.js";
import { extractSoilMap } from "./extractSoilMap.js";
import { findSoilAtPoint } from "./findSoilAtPoint.js";
import { toTwd97Tm2 } from "./projection.js";
import { fetchTownVillage } from "./resolveCity.js";

// This CLI only supports 新北市 (New Taipei City) — enforced by resolving the query
// point's county via NLSC's keyless TownVillagePointQuery API (see resolveCity.ts),
// independent of the soil map dataset's own (unreliable, legacy) 地區 field — see
// temp/plans/soil-quality-cli.md's decision log.
const NEW_TAIPEI_CITY_NAME = "新北市";

const OUTPUT_DIR = "./src/soilQuality/output";

function parseCoordinates(lonArg?: string, latArg?: string): { lon: number; lat: number } {
  const lon = Number(lonArg);
  const lat = Number(latArg);
  if (!lonArg || !latArg || Number.isNaN(lon) || Number.isNaN(lat)) {
    throw new Error("Usage: main.ts <lon> <lat>. Example: main.ts 121.4627 25.0111 (板橋, New Taipei City)");
  }
  return { lon, lat };
}

async function main() {
  const [, , lonArg, latArg] = process.argv;
  const { lon, lat } = parseCoordinates(lonArg, latArg);

  console.log(`Resolving (${lon}, ${lat}) to a county via NLSC TownVillagePointQuery...`);
  const townVillage = await fetchTownVillage(lon, lat);
  if (!townVillage || townVillage.ctyName !== NEW_TAIPEI_CITY_NAME) {
    throw new Error(
      `(${lon}, ${lat}) resolves to ${townVillage?.ctyName ?? "an unknown county"}, not ${NEW_TAIPEI_CITY_NAME} — this CLI only supports New Taipei City.`,
    );
  }
  console.log(`Point falls in ${townVillage.ctyName}${townVillage.townName}`);

  console.log("Downloading/loading cached 土壤圖 (TARI soil map, 74MB, cached after first run)...");
  const zipBuffer = await downloadSoilMap();
  const features = await extractSoilMap(zipBuffer);
  console.log(`Parsed ${features.length} soil polygons nationwide`);

  const point = toTwd97Tm2(lon, lat);
  const soil = findSoilAtPoint(features, point);

  const output = { lon, lat, ctyName: townVillage.ctyName, townName: townVillage.townName, soil };

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
