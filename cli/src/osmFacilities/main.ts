import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTagList } from "./parseTags.js";
import { buildOverpassQuery } from "./buildOverpassQuery.js";
import { queryOverpass } from "./queryOverpass.js";
import { parseOverpassResponse } from "./parseOverpassResponse.js";
import { haversineDistanceMeters } from "./haversine.js";
import type { OsmMatch } from "./parseOverpassResponse.js";

const OUTPUT_DIR = "./src/osmFacilities/output";
const DEFAULT_RADIUS_METERS = 5000;

interface ParsedArgs {
  lon: number;
  lat: number;
  tagsArg: string;
  radiusMeters: number;
}

interface OsmMatchWithDistance extends OsmMatch {
  metersToCenter: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [, , lonArg, latArg, tagsArg, radiusArg] = argv;
  const lon = Number(lonArg);
  const lat = Number(latArg);
  const radiusMeters = radiusArg !== undefined ? Number(radiusArg) : DEFAULT_RADIUS_METERS;
  if (!lonArg || !latArg || !tagsArg || Number.isNaN(lon) || Number.isNaN(lat) || Number.isNaN(radiusMeters)) {
    throw new Error(
      "Usage: main.ts <lon> <lat> <tag1=value1,tag2=value2,...> [radiusMeters]. " +
        "Example: main.ts 121.636 25.221 shop=department_store,amenity=cinema 500",
    );
  }
  return { lon, lat, tagsArg, radiusMeters };
}

async function fetchMatchesForTag(
  tagLabel: string,
  query: string,
  lon: number,
  lat: number,
): Promise<OsmMatchWithDistance[]> {
  const json = await queryOverpass(query);
  const matches = parseOverpassResponse(json, tagLabel);
  return matches.map((match) => ({
    ...match,
    metersToCenter: Math.round(haversineDistanceMeters(lat, lon, match.lat, match.lon)),
  }));
}

async function main() {
  const { lon, lat, tagsArg, radiusMeters } = parseArgs(process.argv);
  const tags = parseTagList(tagsArg);

  const allMatches: OsmMatchWithDistance[] = [];
  const failedTags: string[] = [];
  for (const tag of tags) {
    const tagLabel = `${tag.key}=${tag.value}`;
    console.log(`Querying Overpass for ${tagLabel} within ${radiusMeters}m of (${lon}, ${lat})...`);
    const query = buildOverpassQuery(tag, lat, lon, radiusMeters);
    try {
      allMatches.push(...(await fetchMatchesForTag(tagLabel, query, lon, lat)));
    } catch (err) {
      // One tag exhausting its retries (or being genuinely unsupported) shouldn't cost
      // the results already gathered for every other tag in this run.
      console.warn(`main: skipping tag "${tagLabel}" after it failed — ${(err as Error).message}`);
      failedTags.push(tagLabel);
    }
  }
  allMatches.sort((a, b) => a.metersToCenter - b.metersToCenter);

  const output = {
    center: { lon, lat },
    radiusMeters,
    tags: tags.map((t) => `${t.key}=${t.value}`),
    failedTags,
    matches: allMatches,
  };

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

export { parseArgs };
