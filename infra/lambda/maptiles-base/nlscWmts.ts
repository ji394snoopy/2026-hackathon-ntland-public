// NLSC (國土測繪中心) WMTS RESTful endpoint, discovered from its GetCapabilities docs
// (e.g. https://maps.nlsc.gov.tw/wmtsTOPO05K/wmts?SERVICE=WMTS&REQUEST=GetCapabilities).
// Every NLSC map service shares this same tile host and "GoogleMapsCompatible" tile
// matrix set (Web Mercator / EPSG:3857, 256x256 PNGs, zoom 0-19) — only the layer id
// and, for GetCapabilities, the per-service host path differ between map products.
const WMTS_BASE_URL = "https://wmts.nlsc.gov.tw/wmts";
const TILE_MATRIX_SET = "GoogleMapsCompatible";
const STYLE = "default";
const TILE_SIZE = 256;

// Radius of the EPSG:3857 (Web Mercator) sphere, in meters — half its equatorial
// circumference, so lon=180 maps to x=+WEB_MERCATOR_RADIUS.
const WEB_MERCATOR_RADIUS = 20037508.342789244;

interface TileCoordinate {
  z: number;
  x: number;
  y: number;
}

interface GlobalPixel {
  x: number;
  y: number;
}

interface LonLat {
  lon: number;
  lat: number;
}

// Pixel position within the zoom level's full TILE_SIZE * 2^zoom Web Mercator pixel
// plane — the un-floored version of lonLatToTile, for callers that need to know
// exactly where within its tile a point falls rather than just which tile it's in.
function lonLatToGlobalPixel(lon: number, lat: number, zoom: number): GlobalPixel {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n * TILE_SIZE;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * TILE_SIZE;
  return { x, y };
}

// Inverse of lonLatToGlobalPixel — standard slippy-map tile-to-lonlat formula.
function globalPixelToLonLat(x: number, y: number, zoom: number): LonLat {
  const n = 2 ** zoom;
  const lon = (x / (n * TILE_SIZE)) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / (n * TILE_SIZE))));
  const lat = (latRad * 180) / Math.PI;
  return { lon, lat };
}

// EPSG:3857 (Web Mercator) meters, as used by GetCapabilities' ows:BoundingBox — a
// different unit/orientation than the tile-pixel space lonLatToGlobalPixel works in
// (Y increases northward here, southward there), but both derived from the same lon/lat.
function lonLatToWebMercator(lon: number, lat: number): GlobalPixel {
  const latRad = (lat * Math.PI) / 180;
  const x = (lon * WEB_MERCATOR_RADIUS) / 180;
  const y =
    Math.log(Math.tan(Math.PI / 4 + latRad / 2)) * (WEB_MERCATOR_RADIUS / Math.PI);
  return { x, y };
}

function lonLatToTile(lon: number, lat: number, zoom: number): TileCoordinate {
  const { x, y } = lonLatToGlobalPixel(lon, lat, zoom);
  return { z: zoom, x: Math.floor(x / TILE_SIZE), y: Math.floor(y / TILE_SIZE) };
}

// The lon/lat of a specific tile's own center pixel — used to look up which layer
// covers THAT tile specifically (rather than the original query point), when filling a
// gap tile-by-tile.
function tileCenterLonLat(tile: TileCoordinate): LonLat {
  return globalPixelToLonLat(
    (tile.x + 0.5) * TILE_SIZE,
    (tile.y + 0.5) * TILE_SIZE,
    tile.z,
  );
}

function buildTileUrl(layer: string, tile: TileCoordinate): string {
  return `${WMTS_BASE_URL}/${layer}/${STYLE}/${TILE_MATRIX_SET}/${tile.z}/${tile.y}/${tile.x}`;
}

async function fetchTile(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GetTile failed (${response.status} ${response.statusText}): ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fetchLayerTile(
  layer: string,
  lon: number,
  lat: number,
  zoom: number,
): Promise<{ tile: TileCoordinate; url: string; pngBytes: Buffer }> {
  const tile = lonLatToTile(lon, lat, zoom);
  const url = buildTileUrl(layer, tile);
  const pngBytes = await fetchTile(url);
  return { tile, url, pngBytes };
}

interface GridTileResult {
  tile: TileCoordinate;
  col: number;
  row: number;
  url: string;
  pngBytes: Buffer;
}

// Fetches every tile in the cols x rows rectangle whose top-left tile is firstTile,
// all at firstTile.z. col/row are 0-based, left-to-right/top-to-bottom within that
// rectangle — the raw material for stitchTiles, before any pixel-level cropping.
async function fetchTileRect(
  layer: string,
  firstTile: TileCoordinate,
  cols: number,
  rows: number,
): Promise<GridTileResult[]> {
  const colOffsets = Array.from({ length: cols }, (_, i) => i);
  const rowOffsets = Array.from({ length: rows }, (_, i) => i);

  return Promise.all(
    rowOffsets.flatMap((row) =>
      colOffsets.map(async (col): Promise<GridTileResult> => {
        const tile: TileCoordinate = {
          z: firstTile.z,
          x: firstTile.x + col,
          y: firstTile.y + row,
        };
        const url = buildTileUrl(layer, tile);
        const pngBytes = await fetchTile(url);
        return { tile, col, row, url, pngBytes };
      }),
    ),
  );
}

export {
  TILE_SIZE,
  lonLatToGlobalPixel,
  globalPixelToLonLat,
  lonLatToWebMercator,
  lonLatToTile,
  tileCenterLonLat,
  buildTileUrl,
  fetchTile,
  fetchLayerTile,
  fetchTileRect,
};
export type { TileCoordinate, GlobalPixel, LonLat, GridTileResult };
