import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchCenteredTileImage } from "./fetchCenteredTileImage.js";
import type { BaseLayerMode } from "./fetchCenteredTileImage.js";
import { parseLayerBounds, isNewTaipeiLayer, findLayerForPoint } from "./layers.js";

// Unlike TOPO05K (one nationwide "B5000" mosaic), TOPO01K has no single combined layer:
// each city/county government surveys and publishes its own 1/1000 urban-plan-area
// sheets as a separate WMTS layer (413 of them at last count). This CLI only supports
// 新北市 (New Taipei City), so after fetching the full nationwide GetCapabilities list
// it's filtered down to New Taipei's ~56 layers (isNewTaipeiLayer) before finding which
// one (if any) covers the given point.
const CAPABILITIES_URL =
  "https://maps.nlsc.gov.tw/wmtsTOPO01K/wmts?SERVICE=WMTS&REQUEST=GetCapabilities";

// 19 is the max zoom this service publishes (confirmed it returns genuinely sharper
// imagery there, not just the same tile upscaled) — default to the finest detail
// available; pass an explicit zoom to fetch a coarser, wider-context tile instead.
const DEFAULT_ZOOM = 15;

// radius=0 keeps the original single-tile (256x256) behavior; each step out adds a
// ring of tiles, e.g. radius=1 stitches a 3x3 grid (768x768) centered on the point.
const DEFAULT_RADIUS = 0;

// Shared "falsy" values for the pin/emap toggle args — pass e.g. "0"/"off" to disable.
const TOGGLE_DISABLE_VALUES = new Set(["0", "false", "off", "no"]);

// The pin marker is on by default — pass e.g. "0"/"off" as the pin arg to disable it.
const DEFAULT_PIN = true;

// Plain white canvas is the default background — pass "on" (or "emap") as the emap arg
// to additionally fetch NLSC's EMAP2 basemap and composite it underneath instead (see
// fetchCenteredTileImage.ts), or e.g. "0"/"off" to disable compositing and get the raw
// TOPO01K-only image (transparent gaps).
const DEFAULT_BASE_LAYER_MODE: BaseLayerMode = "white";

const OUTPUT_DIR = "./src/mapTiles/detailTopo/output";

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

async function fetchCapabilitiesXml(): Promise<string> {
  const response = await fetch(CAPABILITIES_URL);
  if (!response.ok) {
    throw new Error(
      `GetCapabilities failed (${response.status} ${response.statusText}): ${CAPABILITIES_URL}`,
    );
  }
  return response.text();
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

  console.log("Fetching TOPO01K capabilities to find the covering 新北市 layer...");
  const layers = parseLayerBounds(await fetchCapabilitiesXml()).filter(isNewTaipeiLayer);
  const layer = findLayerForPoint(layers, lon, lat);
  if (!layer) {
    throw new Error(
      `(${lon}, ${lat}) isn't covered by any 新北市 (New Taipei City) 1/1000都市計畫地形圖 sheet — this CLI only supports New Taipei City.`,
    );
  }
  console.log(`Point falls in layer ${layer.id} (${layer.title})`);

  console.log(
    `Fetching ${layer.id} imagery around (${lon}, ${lat}) at zoom ${zoom}, radius ${radius}` +
      (baseLayerMode === "emap"
        ? ", with EMAP2 base layer"
        : baseLayerMode === "white"
          ? ", with white background"
          : "") +
      (drawPin ? ", with pin marker..." : "..."),
  );
  const { centerTile, tiles, pngBytes, outputSize, neighborLayers } =
    await fetchCenteredTileImage(layer, lon, lat, zoom, radius, drawPin, baseLayerMode, layers);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath =
    radius === 0
      ? `${OUTPUT_DIR}/${layer.id}-${centerTile.z}-${centerTile.x}-${centerTile.y}.png`
      : `${OUTPUT_DIR}/${layer.id}-${centerTile.z}-${centerTile.x}-${centerTile.y}-r${radius}.png`;
  writeFileSync(outputPath, pngBytes);
  console.log(
    `Fetched ${tiles.length} tile(s) to build a ${outputSize}x${outputSize} image, e.g. ${tiles[0]!.url}`,
  );
  if (neighborLayers.length > 0) {
    console.log(
      `Filled coverage gaps using neighboring layer(s): ${neighborLayers
        .map((neighbor) => `${neighbor.id} (${neighbor.title})`)
        .join(", ")}`,
    );
  }
  console.log(`Wrote ${outputPath}`);
}

export { parseBaseLayerMode };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
