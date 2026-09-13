import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Keyless MOA (農業部) open-data download — confirmed live during planning: the
// dataset's file-listing API redirects to a stable zip URL. Hardcoded rather than
// re-resolved through the listing API on every run, since that indirection buys nothing
// here (there's only ever one file for this dataset, unlike drainageQuality's 4
// per-layer WRA codes).
const SOIL_MAP_LISTING_URL = "https://data.moa.gov.tw/api/FileToJson.ashx?DataId=159&DataTable=OpenDataList";
const CACHE_DIR = "./src/soilQuality/cache";
const CACHE_PATH = `${CACHE_DIR}/soilmap.zip`;

interface OpenDataListEntry {
  FileUrl: string;
}

// Downloads the national 土壤圖 SHP zip (73.8MB), caching it to disk so repeat runs
// don't re-hit MOA's server. Not unit tested — network + fs glue, verified by an actual
// `npm run fetch:soil` run (see README), same convention as
// drainageQuality/downloadLayer.ts.
async function downloadSoilMap(): Promise<Buffer> {
  if (existsSync(CACHE_PATH)) {
    return readFileSync(CACHE_PATH);
  }

  const listingResponse = await fetch(SOIL_MAP_LISTING_URL);
  if (!listingResponse.ok) {
    throw new Error(
      `MOA open-data file listing failed (${listingResponse.status} ${listingResponse.statusText}): ${SOIL_MAP_LISTING_URL}`,
    );
  }
  const entries = (await listingResponse.json()) as OpenDataListEntry[];
  const fileUrl = entries[0]?.FileUrl;
  if (!fileUrl) {
    throw new Error(`MOA open-data file listing returned no entries: ${SOIL_MAP_LISTING_URL}`);
  }

  const zipResponse = await fetch(fileUrl);
  if (!zipResponse.ok) {
    throw new Error(`Soil map zip download failed (${zipResponse.status} ${zipResponse.statusText}): ${fileUrl}`);
  }
  const buffer = Buffer.from(await zipResponse.arrayBuffer());

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_PATH, buffer);
  return buffer;
}

export { downloadSoilMap };
