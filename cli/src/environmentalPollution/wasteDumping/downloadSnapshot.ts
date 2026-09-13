import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { queryMoenvDataset } from "../moenvClient.js";

const CATALOG_DATASET = "wr_p_244";
const CACHE_DIR = "./src/environmentalPollution/wasteDumping/cache";

interface CatalogRecord {
  filename?: unknown;
  url?: unknown;
  upload_date?: unknown;
}

// wr_p_244 isn't a records API like the other datasets here — it's a catalog of
// periodic ZIP-packaged shapefile snapshots (WDMS-WGS84-YYYYMMDD.zip). Not unit
// tested — network + fs glue, verified by an actual `npm run fetch:waste-dumping` run
// (see README).
async function downloadLatestSnapshot(apiKey: string): Promise<Buffer> {
  const catalog = (await queryMoenvDataset(CATALOG_DATASET, apiKey, {
    limit: 1,
    sort: "upload_date desc",
  })) as CatalogRecord[];
  const latest = catalog[0];
  if (!latest || typeof latest.filename !== "string" || typeof latest.url !== "string") {
    throw new Error(`downloadLatestSnapshot: ${CATALOG_DATASET} catalog returned no usable entry`);
  }

  const cachePath = `${CACHE_DIR}/${latest.filename}`;
  if (existsSync(cachePath)) {
    return readFileSync(cachePath);
  }

  const response = await fetch(latest.url);
  if (!response.ok) {
    throw new Error(`Snapshot download failed (${response.status} ${response.statusText}): ${latest.url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, buffer);
  return buffer;
}

export { downloadLatestSnapshot };
