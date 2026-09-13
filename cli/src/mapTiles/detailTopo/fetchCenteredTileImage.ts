import {
  fetchTileRect,
  fetchTile,
  buildTileUrl,
  lonLatToGlobalPixel,
  tileCenterLonLat,
  TILE_SIZE,
} from "./nlscWmts.js";
import type { TileCoordinate, GridTileResult } from "./nlscWmts.js";
import {
  stitchTiles,
  createBlankCanvas,
  compositeOver,
  isTileFullyTransparent,
  transparentPixelRatio,
  cropRegion,
  drawMarker,
} from "./stitchTiles.js";
import { rankLayersCoveringPoint } from "./layers.js";
import type { LayerBounds } from "./layers.js";

// 臺灣通用電子地圖透明 — a nationwide PNG basemap (roads/labels, transparent background)
// composited underneath the requested layer so its own fully-transparent "no coverage"
// pixels show a real map instead of the raw (0,0,0,0) black some viewers render for
// unhandled alpha.
const BASE_LAYER_ID = "EMAP2";
const CANVAS_BACKGROUND: [number, number, number, number] = [255, 255, 255, 255];

// "emap" composites the EMAP2 basemap underneath (default); "white" skips the EMAP2
// fetch and composites onto a plain white canvas instead; "off" skips the base-layer
// compositing step, preserving TOPO01K's raw transparency for gaps — though a gap that
// per-tile neighbor-layer fill (below) resolves still forces a canvas regardless of
// mode, same as before this type existed.
type BaseLayerMode = "emap" | "white" | "off";

// A district boundary commonly cuts through the middle of a tile rather than landing on
// a tile edge, leaving a tile mostly — but not uniformly — transparent (confirmed live:
// tiles at 78%, 92%, 97% transparent, none of them 100%). Requiring full transparency
// missed these; requiring ANY transparency would over-trigger, since real-content tiles
// are themselves a large-but-partial mix of opaque line art on transparent background
// (confirmed live: as low as ~19% opaque). "Majority blank" is the dividing line.
const GAP_TRANSPARENCY_THRESHOLD = 0.5;

interface CenteredTileImage {
  pngBytes: Buffer;
  centerTile: TileCoordinate;
  tiles: GridTileResult[];
  outputSize: number;
  neighborLayers: LayerBounds[];
}

// lonLatToTile just floors to whichever tile contains (lon, lat) — a tile-grid built
// around that tile can be off-center by up to half a tile, since the point can fall
// anywhere inside it. So this fetches one extra ring of tiles beyond the requested
// (radius*2+1)*TILE_SIZE box, stitches them, and crops to the exact box before
// (optionally) marking the point — rather than trusting the tile grid's own center to
// line up with it.
async function fetchCenteredTileImage(
  primaryLayer: LayerBounds,
  lon: number,
  lat: number,
  zoom: number,
  radius: number,
  drawPin: boolean,
  baseLayerMode: BaseLayerMode,
  candidateLayers: LayerBounds[],
): Promise<CenteredTileImage> {
  const outputSize = (radius * 2 + 1) * TILE_SIZE;
  const centerPixel = lonLatToGlobalPixel(lon, lat, zoom);
  const centerX = Math.round(centerPixel.x);
  const centerY = Math.round(centerPixel.y);
  const boxLeft = centerX - outputSize / 2;
  const boxTop = centerY - outputSize / 2;

  const firstTile: TileCoordinate = {
    z: zoom,
    x: Math.floor(boxLeft / TILE_SIZE),
    y: Math.floor(boxTop / TILE_SIZE),
  };
  const lastTileX = Math.floor((boxLeft + outputSize - 1) / TILE_SIZE);
  const lastTileY = Math.floor((boxTop + outputSize - 1) / TILE_SIZE);
  const gridCols = lastTileX - firstTile.x + 1;
  const gridRows = lastTileY - firstTile.y + 1;

  const tiles = await fetchTileRect(primaryLayer.id, firstTile, gridCols, gridRows);
  const primaryStitched = stitchTiles(tiles, gridCols, gridRows);

  // Bottom-to-top compositing order: EMAP2 (generic basemap) first, then a neighboring
  // 新北市 layer (more authoritative topo detail) if one fills a gap, then the primary
  // layer always on top. Only built when there's actually something to composite —
  // otherwise `stitched` stays the raw primary tiles, preserving true PNG transparency
  // for viewers that handle it (no white canvas forced in when nothing needs filling).
  const layersUnderneath: Buffer[] = [];

  if (baseLayerMode === "emap") {
    const baseTiles = await fetchTileRect(BASE_LAYER_ID, firstTile, gridCols, gridRows);
    layersUnderneath.push(stitchTiles(baseTiles, gridCols, gridRows));
  }

  // Per-tile gap fill: each blank tile gets its own point-based lookup (the same
  // logic that picks the primary layer, applied to that tile's own center coordinate
  // instead of the original query point), tried single-tile-fetch-at-a-time until one
  // candidate actually has content there. Different blank tiles can resolve to
  // different neighboring layers — correctly handles a grid spanning more than one
  // district's true boundary, unlike a single whole-grid neighbor pick.
  const patches: GridTileResult[] = [];
  const neighborLayersUsed = new Map<string, LayerBounds>();
  for (const blankTile of tiles.filter(
    (tile) => transparentPixelRatio(tile.pngBytes) >= GAP_TRANSPARENCY_THRESHOLD,
  )) {
    const { lon: tileLon, lat: tileLat } = tileCenterLonLat(blankTile.tile);
    const candidates = rankLayersCoveringPoint(
      candidateLayers,
      primaryLayer.id,
      tileLon,
      tileLat,
    );
    for (const candidate of candidates) {
      const url = buildTileUrl(candidate.id, blankTile.tile);
      const pngBytes = await fetchTile(url);
      if (!isTileFullyTransparent(pngBytes)) {
        patches.push({ tile: blankTile.tile, col: blankTile.col, row: blankTile.row, url, pngBytes });
        neighborLayersUsed.set(candidate.id, candidate);
        break;
      }
    }
  }
  if (patches.length > 0) {
    layersUnderneath.push(stitchTiles(patches, gridCols, gridRows));
  }

  let stitched = primaryStitched;
  if (baseLayerMode !== "off" || layersUnderneath.length > 0) {
    const canvas = createBlankCanvas(gridCols * TILE_SIZE, gridRows * TILE_SIZE, CANVAS_BACKGROUND);
    stitched = [canvas, ...layersUnderneath, primaryStitched].reduce(compositeOver);
  }

  const cropX = boxLeft - firstTile.x * TILE_SIZE;
  const cropY = boxTop - firstTile.y * TILE_SIZE;
  const cropped = cropRegion(stitched, cropX, cropY, outputSize, outputSize);
  const pngBytes = drawPin ? drawMarker(cropped, outputSize / 2, outputSize / 2) : cropped;

  const centerTile: TileCoordinate = {
    z: zoom,
    x: Math.floor(centerX / TILE_SIZE),
    y: Math.floor(centerY / TILE_SIZE),
  };
  return {
    pngBytes,
    centerTile,
    tiles,
    outputSize,
    neighborLayers: [...neighborLayersUsed.values()],
  };
}

export { fetchCenteredTileImage };
export type { CenteredTileImage, BaseLayerMode };
