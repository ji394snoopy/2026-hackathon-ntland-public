import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { DrainageLayer } from "./layers.js";

// Keyless WRA download endpoint — confirmed live for all 4 layers this module uses.
const WRA_DOWNLOAD_URL = "https://gic.wra.gov.tw/gis/gic/API/Google/DownLoad.aspx";
const CACHE_DIR = "./src/drainageQuality/cache";

// Downloads a layer's SHP zip, caching it to disk so repeat runs (including repeat test
// runs against the same layer) don't re-hit WRA's server. Not unit tested — network + fs
// glue, verified by an actual `npm run fetch:drainage` run (see README).
async function downloadLayer(layer: DrainageLayer): Promise<Buffer> {
  const cachePath = `${CACHE_DIR}/${layer.wraCode}.zip`;
  if (existsSync(cachePath)) {
    return readFileSync(cachePath);
  }

  const url = `${WRA_DOWNLOAD_URL}?fname=${layer.wraCode}&filetype=SHP`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`WRA DownLoad.aspx failed (${response.status} ${response.statusText}): ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, buffer);
  return buffer;
}

export { downloadLayer };
