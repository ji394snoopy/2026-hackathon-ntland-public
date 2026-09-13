import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DRAINAGE_LAYERS } from "./layers.js";
import { downloadLayer } from "./downloadLayer.js";
import { extractLayer } from "./extractLayer.js";
import { filterToCounty, findNearestFeature } from "./nearestFeature.js";
import { toTwd97Tm2 } from "./projection.js";
import { fetchTownVillage } from "./resolveCity.js";
import type { NearestResult } from "./nearestFeature.js";

// This CLI only supports 新北市 (New Taipei City) — enforced by resolving the query
// point's county via NLSC's keyless TownVillagePointQuery API (see resolveCity.ts)
// rather than a bounding box, since no per-district boundary layer exists for this
// domain the way detailTopo has for TOPO01K sheets.
const NEW_TAIPEI_CITY_NAME = "新北市";

const OUTPUT_DIR = "./src/drainageQuality/output";

interface LayerResult {
  layer: string; // English layer key, e.g. "pumpingStation"
  layerZh: string;
  nearest: NearestResult | null;
}

async function lookupLayer(
  layer: (typeof DRAINAGE_LAYERS)[number],
  point: [number, number],
): Promise<LayerResult> {
  const zipBuffer = await downloadLayer(layer);
  const features = await extractLayer(zipBuffer);
  const newTaipeiFeatures = filterToCounty(features, layer.countyField, NEW_TAIPEI_CITY_NAME);
  const nearest = findNearestFeature(layer, newTaipeiFeatures, point);
  return { layer: layer.nameEn, layerZh: layer.nameZh, nearest };
}

async function main() {
  const [, , lonArg, latArg] = process.argv;
  const lon = Number(lonArg);
  const lat = Number(latArg);
  if (!lonArg || !latArg || Number.isNaN(lon) || Number.isNaN(lat)) {
    throw new Error(
      "Usage: main.ts <lon> <lat>. Example: main.ts 121.4627 25.0111 (板橋, New Taipei City)",
    );
  }

  console.log(`Resolving (${lon}, ${lat}) to a county via NLSC TownVillagePointQuery...`);
  const townVillage = await fetchTownVillage(lon, lat);
  if (!townVillage || townVillage.ctyName !== NEW_TAIPEI_CITY_NAME) {
    throw new Error(
      `(${lon}, ${lat}) resolves to ${townVillage?.ctyName ?? "an unknown county"}, not ${NEW_TAIPEI_CITY_NAME} — this CLI only supports New Taipei City.`,
    );
  }
  console.log(`Point falls in ${townVillage.ctyName}${townVillage.townName}`);

  const point = toTwd97Tm2(lon, lat);

  const results: LayerResult[] = [];
  for (const layer of DRAINAGE_LAYERS) {
    console.log(`Fetching ${layer.wraCode} (${layer.nameZh})...`);
    results.push(await lookupLayer(layer, point));
  }

  const output = { lon, lat, ctyName: townVillage.ctyName, townName: townVillage.townName, results };

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
