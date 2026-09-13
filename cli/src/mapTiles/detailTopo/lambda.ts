import { fetchCenteredTileImage } from "./fetchCenteredTileImage.js";
import type { BaseLayerMode } from "./fetchCenteredTileImage.js";
import { parseLayerBounds, isNewTaipeiLayer, findLayerForPoint } from "./layers.js";
import type { LayerBounds } from "./layers.js";

// See main.ts for the rationale behind these constants — this handler mirrors the CLI's
// defaults so the HTTP surface behaves the same as `pnpm fetch:topo`.
const CAPABILITIES_URL =
  "https://maps.nlsc.gov.tw/wmtsTOPO01K/wmts?SERVICE=WMTS&REQUEST=GetCapabilities";
const DEFAULT_ZOOM = 15;
const DEFAULT_RADIUS = 0;
const TOGGLE_DISABLE_VALUES = new Set(["0", "false", "off", "no"]);
const DEFAULT_PIN = true;
const DEFAULT_BASE_LAYER_MODE: BaseLayerMode = "white";

const MAX_RADIUS = 4;
const MIN_ZOOM = 0;
const MAX_ZOOM = 19;

// TOPO01K has 413 nationwide layers with no combined mosaic, so every request would
// otherwise re-fetch + re-parse the (large) GetCapabilities XML just to find the ~56 新
// 北市 sheets. Caching the parsed New Taipei layer list in module scope means only the
// first invocation on a given warm Lambda execution environment pays that cost; the
// rest reuse it. The list is a static NLSC publication that changes at most on a survey
// republish, so a per-execution-environment cache (naturally refreshed on cold start)
// is a safe staleness tradeoff.
let newTaipeiLayersCache: LayerBounds[] | undefined;

async function getNewTaipeiLayers(): Promise<LayerBounds[]> {
  if (newTaipeiLayersCache) return newTaipeiLayersCache;
  const response = await fetch(CAPABILITIES_URL);
  if (!response.ok) {
    throw new Error(
      `GetCapabilities failed (${response.status} ${response.statusText}): ${CAPABILITIES_URL}`,
    );
  }
  const xml = await response.text();
  newTaipeiLayersCache = parseLayerBounds(xml).filter(isNewTaipeiLayer);
  return newTaipeiLayersCache;
}

interface FunctionUrlEvent {
  queryStringParameters?: Record<string, string | undefined> | null;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

function parseBaseLayerMode(arg: string | undefined): BaseLayerMode {
  if (!arg) return DEFAULT_BASE_LAYER_MODE;
  const normalized = arg.toLowerCase();
  if (TOGGLE_DISABLE_VALUES.has(normalized)) return "off";
  if (normalized === "white") return "white";
  return "emap";
}

function errorResponse(statusCode: number, message: string): LambdaResponse {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify({ error: message }),
  };
}

/**
 * detailTopo (1/1000 都市計畫地形圖 TOPO01K, 新北市 only) as a Lambda Function URL handler.
 *
 * GET ?lon=&lat=&zoom=&radius=&pin=&emap= -> a PNG (base64, isBase64Encoded). Resolves
 * which New Taipei sheet covers the point from a module-cached GetCapabilities parse.
 */
export async function handler(event: FunctionUrlEvent): Promise<LambdaResponse> {
  const params = event.queryStringParameters ?? {};
  const lon = Number(params.lon);
  const lat = Number(params.lat);
  if (!params.lon || !params.lat || Number.isNaN(lon) || Number.isNaN(lat)) {
    return errorResponse(
      400,
      "Missing or invalid coordinates. Pass ?lon=<lon>&lat=<lat>, e.g. ?lon=121.4627&lat=25.0111.",
    );
  }

  const zoom = params.zoom ? Number(params.zoom) : DEFAULT_ZOOM;
  const radius = params.radius ? Number(params.radius) : DEFAULT_RADIUS;
  if (!Number.isInteger(zoom) || zoom < MIN_ZOOM || zoom > MAX_ZOOM) {
    return errorResponse(400, `zoom must be an integer in [${MIN_ZOOM}, ${MAX_ZOOM}].`);
  }
  if (!Number.isInteger(radius) || radius < 0 || radius > MAX_RADIUS) {
    return errorResponse(400, `radius must be an integer in [0, ${MAX_RADIUS}].`);
  }
  const drawPin = params.pin ? !TOGGLE_DISABLE_VALUES.has(params.pin.toLowerCase()) : DEFAULT_PIN;
  const baseLayerMode = parseBaseLayerMode(params.emap);

  try {
    const layers = await getNewTaipeiLayers();
    const layer = findLayerForPoint(layers, lon, lat);
    if (!layer) {
      return errorResponse(
        404,
        `(${lon}, ${lat}) isn't covered by any 新北市 (New Taipei City) 1/1000 都市計畫地形圖 sheet — this endpoint only supports New Taipei City.`,
      );
    }

    const { pngBytes } = await fetchCenteredTileImage(
      layer,
      lon,
      lat,
      zoom,
      radius,
      drawPin,
      baseLayerMode,
      layers,
    );

    return {
      statusCode: 200,
      headers: {
        "content-type": "image/png",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=86400",
      },
      body: pngBytes.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(502, message);
  }
}
