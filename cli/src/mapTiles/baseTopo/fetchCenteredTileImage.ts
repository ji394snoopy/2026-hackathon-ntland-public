import { fetchTileRect, lonLatToGlobalPixel, TILE_SIZE } from "./nlscWmts.js";
import type { TileCoordinate, GridTileResult } from "./nlscWmts.js";
import {
  stitchTiles,
  createBlankCanvas,
  compositeOver,
  cropRegion,
  drawMarker,
} from "./stitchTiles.js";

// 臺灣通用電子地圖透明 — a nationwide PNG basemap (roads/labels, transparent background)
// composited underneath B5000 so its own fully-transparent "no coverage" pixels show a
// real map instead of the raw (0,0,0,0) black some viewers render for unhandled alpha.
const BASE_LAYER_ID = "EMAP2";
const CANVAS_BACKGROUND: [number, number, number, number] = [255, 255, 255, 255];

// "emap" composites the EMAP2 basemap underneath (default); "white" skips the EMAP2
// fetch and composites onto a plain white canvas instead; "off" skips compositing
// entirely, preserving B5000's raw transparency for gaps.
type BaseLayerMode = "emap" | "white" | "off";

interface CenteredTileImage {
  pngBytes: Buffer;
  centerTile: TileCoordinate;
  tiles: GridTileResult[];
  outputSize: number;
}

// lonLatToTile just floors to whichever tile contains (lon, lat) — a tile-grid built
// around that tile can be off-center by up to half a tile, since the point can fall
// anywhere inside it. So this fetches one extra ring of tiles beyond the requested
// (radius*2+1)*TILE_SIZE box, stitches them, and crops to the exact box before
// (optionally) marking the point — rather than trusting the tile grid's own center to
// line up with it. Unlike detailTopo's version of this function, there's only ever one
// primary layer ("B5000") — no per-district lookup and no per-tile neighbor-layer gap
// fill, since B5000 is a single nationwide mosaic rather than ~56 overlapping sheets.
async function fetchCenteredTileImage(
  layer: string,
  lon: number,
  lat: number,
  zoom: number,
  radius: number,
  drawPin: boolean,
  baseLayerMode: BaseLayerMode,
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

  const tiles = await fetchTileRect(layer, firstTile, gridCols, gridRows);
  const primaryStitched = stitchTiles(tiles, gridCols, gridRows);

  let stitched = primaryStitched;
  if (baseLayerMode !== "off") {
    const layersUnderneath: Buffer[] = [];
    if (baseLayerMode === "emap") {
      const baseTiles = await fetchTileRect(BASE_LAYER_ID, firstTile, gridCols, gridRows);
      layersUnderneath.push(stitchTiles(baseTiles, gridCols, gridRows));
    }
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
  return { pngBytes, centerTile, tiles, outputSize };
}

export { fetchCenteredTileImage };
export type { CenteredTileImage, BaseLayerMode };
