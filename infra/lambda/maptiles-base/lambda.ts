import { fetchCenteredTileImage } from "./fetchCenteredTileImage.js";
import type { BaseLayerMode } from "./fetchCenteredTileImage.js";

// See main.ts for the rationale behind these constants — this handler mirrors the CLI's
// defaults so the HTTP surface behaves the same as `pnpm fetch:base`.
const LAYER_ID = "B5000";
const DEFAULT_ZOOM = 15;
const DEFAULT_RADIUS = 0;
const TOGGLE_DISABLE_VALUES = new Set(["0", "false", "off", "no"]);
const DEFAULT_PIN = true;
const DEFAULT_BASE_LAYER_MODE: BaseLayerMode = "white";

// Guard rails so a single request can't ask us to stitch an enormous grid of upstream
// tiles (each radius step is a (2r+1)^2 tile fetch). radius=4 -> 9x9 = 81 tiles.
const MAX_RADIUS = 4;
const MIN_ZOOM = 0;
const MAX_ZOOM = 19;

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
 * baseTopo (1/5000 基本地形圖 B5000) as a Lambda Function URL handler.
 *
 * GET ?lon=&lat=&zoom=&radius=&pin=&emap= -> a PNG (base64, isBase64Encoded) centered on
 * the point. Fixed nationwide layer, so no GetCapabilities call is needed.
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
    const { pngBytes } = await fetchCenteredTileImage(
      LAYER_ID,
      lon,
      lat,
      zoom,
      radius,
      drawPin,
      baseLayerMode,
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
