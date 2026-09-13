import { PNG } from "pngjs";
import { TILE_SIZE } from "./nlscWmts.js";
import type { GridTileResult } from "./nlscWmts.js";

function stitchTiles(tiles: GridTileResult[], gridWidth: number, gridHeight: number): Buffer {
  const output = new PNG({ width: gridWidth * TILE_SIZE, height: gridHeight * TILE_SIZE });
  for (const { col, row, pngBytes } of tiles) {
    const tile = PNG.sync.read(pngBytes);
    PNG.bitblt(tile, output, 0, 0, TILE_SIZE, TILE_SIZE, col * TILE_SIZE, row * TILE_SIZE);
  }
  return PNG.sync.write(output);
}

function createBlankCanvas(
  width: number,
  height: number,
  color: [number, number, number, number],
): Buffer {
  const canvas = new PNG({ width, height });
  for (let i = 0; i < canvas.data.length; i += 4) {
    canvas.data[i] = color[0];
    canvas.data[i + 1] = color[1];
    canvas.data[i + 2] = color[2];
    canvas.data[i + 3] = color[3];
  }
  return PNG.sync.write(canvas);
}

// Porter-Duff "over": alpha-blends overlayBytes on top of baseBytes, pixel by pixel.
// Unlike PNG.bitblt (a raw byte copy), this respects the overlay's alpha channel — used
// to let a base map show through TOPO01K's fully-transparent "no coverage" pixels
// instead of a raw copy clobbering the base with those pixels' (0,0,0,0). Both buffers
// must be the same width/height.
function compositeOver(baseBytes: Buffer, overlayBytes: Buffer): Buffer {
  const base = PNG.sync.read(baseBytes);
  const overlay = PNG.sync.read(overlayBytes);
  for (let i = 0; i < base.data.length; i += 4) {
    const overlayAlpha = overlay.data[i + 3]! / 255;
    if (overlayAlpha === 0) continue;
    if (overlayAlpha === 1) {
      base.data[i] = overlay.data[i]!;
      base.data[i + 1] = overlay.data[i + 1]!;
      base.data[i + 2] = overlay.data[i + 2]!;
      base.data[i + 3] = 255;
      continue;
    }
    const baseAlpha = base.data[i + 3]! / 255;
    const outAlpha = overlayAlpha + baseAlpha * (1 - overlayAlpha);
    for (let channel = 0; channel < 3; channel++) {
      const blended =
        (overlay.data[i + channel]! * overlayAlpha +
          base.data[i + channel]! * baseAlpha * (1 - overlayAlpha)) /
        (outAlpha || 1);
      base.data[i + channel] = Math.round(blended);
    }
    base.data[i + 3] = Math.round(outAlpha * 255);
  }
  return PNG.sync.write(base);
}

// A tile the layer genuinely has no coverage for comes back alpha=0 for every pixel
// (confirmed against a live no-coverage TOPO01K tile) — unlike a real-content tile,
// which is typically a large-but-partial mix of opaque/transparent pixels (line art on
// a transparent background), so checking for ANY transparent pixel would false-positive
// on nearly every real tile too.
function isTileFullyTransparent(pngBytes: Buffer): boolean {
  const png = PNG.sync.read(pngBytes);
  for (let i = 3; i < png.data.length; i += 4) {
    if (png.data[i] !== 0) return false;
  }
  return true;
}

// Fraction (0-1) of a tile's pixels that are fully transparent (alpha=0) — used to
// detect a tile that's mostly empty (e.g. a district boundary cuts through the middle
// of it) even though it isn't uniformly blank, which isTileFullyTransparent alone would
// miss.
function transparentPixelRatio(pngBytes: Buffer): number {
  const png = PNG.sync.read(pngBytes);
  let transparent = 0;
  const total = png.width * png.height;
  for (let i = 3; i < png.data.length; i += 4) {
    if (png.data[i] === 0) transparent++;
  }
  return transparent / total;
}

function cropRegion(
  pngBytes: Buffer,
  x: number,
  y: number,
  width: number,
  height: number,
): Buffer {
  const src = PNG.sync.read(pngBytes);
  const dst = new PNG({ width, height });
  PNG.bitblt(src, dst, x, y, width, height, 0, 0);
  return PNG.sync.write(dst);
}

// A filled dot with a contrasting white ring, legible over any tile color underneath —
// the same convention as a standard "you are here" map pin.
const MARKER_RADIUS = 6;
const MARKER_RING_WIDTH = 2;
const MARKER_FILL_COLOR: [number, number, number, number] = [230, 30, 30, 255];
const MARKER_RING_COLOR: [number, number, number, number] = [255, 255, 255, 255];

function drawMarker(pngBytes: Buffer, x: number, y: number): Buffer {
  const png = PNG.sync.read(pngBytes);
  for (let dy = -MARKER_RADIUS; dy <= MARKER_RADIUS; dy++) {
    for (let dx = -MARKER_RADIUS; dx <= MARKER_RADIUS; dx++) {
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > MARKER_RADIUS) continue;
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;

      const color =
        distance > MARKER_RADIUS - MARKER_RING_WIDTH ? MARKER_RING_COLOR : MARKER_FILL_COLOR;
      const idx = (png.width * py + px) << 2;
      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = color[3];
    }
  }
  return PNG.sync.write(png);
}

export {
  stitchTiles,
  createBlankCanvas,
  compositeOver,
  isTileFullyTransparent,
  transparentPixelRatio,
  cropRegion,
  drawMarker,
};
