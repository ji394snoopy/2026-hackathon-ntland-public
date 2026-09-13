import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchCenteredTileImage } from "./fetchCenteredTileImage.js";
import type { BaseLayerMode } from "./fetchCenteredTileImage.js";

// TOPO05K's live GetCapabilities lists one nationwide merged layer, "B5000"
// (1/5000基本地形圖(全)), alongside per-year snapshots (TOPO05K_111, _110, ...). Unlike
// detailTopo's TOPO01K (~56 separate per-city sheets needing a GetCapabilities fetch +
// point-in-bbox lookup to find the covering layer), B5000 is a single fixed layer id —
// no runtime GetCapabilities call needed at all.
const LAYER_ID = "B5000";

// Confirmed live at 5 New Taipei points (Banqiao, Sanchong, Tamsui, Xindian, Tucheng):
// B5000 has real (non-blank) content through zoom 19 at all of them, so this mirrors
// detailTopo's default rather than backing off to a coarser zoom.
const DEFAULT_ZOOM = 15;

// radius=0 keeps a single-tile (256x256) fetch; each step out adds a ring of tiles,
// e.g. radius=1 stitches a 3x3 grid (768x768) centered on the point.
const DEFAULT_RADIUS = 0;

// Shared "falsy" values for the pin/emap toggle args — pass e.g. "0"/"off" to disable.
const TOGGLE_DISABLE_VALUES = new Set(["0", "false", "off", "no"]);

// The pin marker is on by default — pass e.g. "0"/"off" as the pin arg to disable it.
const DEFAULT_PIN = true;

// Plain white canvas is the default background — pass "on" (or "emap") as the emap arg
// to additionally fetch NLSC's EMAP2 basemap and composite it underneath instead (see
// fetchCenteredTileImage.ts), or e.g. "0"/"off" to disable compositing and get the raw
// B5000-only image (transparent gaps).
const DEFAULT_BASE_LAYER_MODE: BaseLayerMode = "white";

const OUTPUT_DIR = "./src/mapTiles/baseTopo/output";

// Anything not recognized as "white" or an off-alias falls back to the default "emap"
// mode — permissive, matching the old boolean toggle's behavior where an unrecognized
// non-disable value (e.g. "on") was silently treated as enabled.
function parseBaseLayerMode(arg: string | undefined): BaseLayerMode {
  if (!arg) return DEFAULT_BASE_LAYER_MODE;
  const normalized = arg.toLowerCase();
  if (TOGGLE_DISABLE_VALUES.has(normalized)) return "off";
  if (normalized === "white") return "white";
  return "emap";
}

async function main() {
  const [, , lonArg, latArg, zoomArg, radiusArg, pinArg, emapArg] = process.argv;
  const lon = Number(lonArg);
  const lat = Number(latArg);
  if (!lonArg || !latArg || Number.isNaN(lon) || Number.isNaN(lat)) {
    throw new Error(
      "Usage: main.ts <lon> <lat> [zoom] [radius] [pin] [emap]. " +
        "pin/emap both default to on; pass 0/off/false/no to disable the marker / the " +
        "EMAP2 base layer, respectively. Example: main.ts 121.4627 25.0111 15 1",
    );
  }
  const zoom = zoomArg ? Number(zoomArg) : DEFAULT_ZOOM;
  const radius = radiusArg ? Number(radiusArg) : DEFAULT_RADIUS;
  const drawPin = pinArg
    ? !TOGGLE_DISABLE_VALUES.has(pinArg.toLowerCase())
    : DEFAULT_PIN;
  const baseLayerMode = parseBaseLayerMode(emapArg);

  console.log(
    `Fetching ${LAYER_ID} imagery around (${lon}, ${lat}) at zoom ${zoom}, radius ${radius}` +
      (baseLayerMode === "emap"
        ? ", with EMAP2 base layer"
        : baseLayerMode === "white"
          ? ", with white background"
          : "") +
      (drawPin ? ", with pin marker..." : "..."),
  );
  const { centerTile, tiles, pngBytes, outputSize } = await fetchCenteredTileImage(
    LAYER_ID,
    lon,
    lat,
    zoom,
    radius,
    drawPin,
    baseLayerMode,
  );

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath =
    radius === 0
      ? `${OUTPUT_DIR}/${LAYER_ID}-${centerTile.z}-${centerTile.x}-${centerTile.y}.png`
      : `${OUTPUT_DIR}/${LAYER_ID}-${centerTile.z}-${centerTile.x}-${centerTile.y}-r${radius}.png`;
  writeFileSync(outputPath, pngBytes);
  console.log(
    `Fetched ${tiles.length} tile(s) to build a ${outputSize}x${outputSize} image, e.g. ${tiles[0]!.url}`,
  );
  console.log(`Wrote ${outputPath}`);
}

export { parseBaseLayerMode };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
