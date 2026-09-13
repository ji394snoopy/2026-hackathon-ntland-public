import type { OsmTag } from "./parseTags.js";

const OVERPASS_TIMEOUT_SECONDS = 25;

function buildOverpassQuery(tag: OsmTag, lat: number, lon: number, radiusMeters: number): string {
  return (
    `[out:json][timeout:${OVERPASS_TIMEOUT_SECONDS}];\n` +
    `nwr["${tag.key}"="${tag.value}"](around:${radiusMeters},${lat},${lon});\n` +
    "out center;"
  );
}

export { buildOverpassQuery };
