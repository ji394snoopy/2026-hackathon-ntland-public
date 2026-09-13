import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import {
  createBlankCanvas,
  compositeOver,
  isTileFullyTransparent,
  transparentPixelRatio,
} from "../../../src/mapTiles/detailTopo/stitchTiles.js";

function makePixelPng(rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width: 1, height: 1 });
  png.data[0] = rgba[0];
  png.data[1] = rgba[1];
  png.data[2] = rgba[2];
  png.data[3] = rgba[3];
  return PNG.sync.write(png);
}

function readPixel(pngBytes: Buffer): [number, number, number, number] {
  const png = PNG.sync.read(pngBytes);
  return [png.data[0]!, png.data[1]!, png.data[2]!, png.data[3]!];
}

test("createBlankCanvas: fills every pixel with the given color", () => {
  const canvas = createBlankCanvas(2, 2, [255, 255, 255, 255]);
  const png = PNG.sync.read(canvas);
  assert.equal(png.width, 2);
  assert.equal(png.height, 2);
  for (let i = 0; i < png.data.length; i += 4) {
    assert.deepEqual(
      [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]],
      [255, 255, 255, 255],
    );
  }
});

test("compositeOver: a fully-opaque overlay pixel replaces the base pixel", () => {
  const base = makePixelPng([255, 255, 255, 255]);
  const overlay = makePixelPng([10, 20, 30, 255]);
  assert.deepEqual(readPixel(compositeOver(base, overlay)), [10, 20, 30, 255]);
});

test("compositeOver: a fully-transparent overlay pixel leaves the base pixel untouched", () => {
  const base = makePixelPng([10, 20, 30, 255]);
  const overlay = makePixelPng([200, 200, 200, 0]);
  assert.deepEqual(readPixel(compositeOver(base, overlay)), [10, 20, 30, 255]);
});

test("compositeOver: a half-transparent overlay pixel blends toward the overlay color", () => {
  const base = makePixelPng([0, 0, 0, 255]);
  const overlay = makePixelPng([200, 200, 200, 128]);
  const [r, g, b, a] = readPixel(compositeOver(base, overlay));
  assert.ok(r > 90 && r < 110, `expected a mid blend, got r=${r}`);
  assert.equal(r, g);
  assert.equal(g, b);
  assert.equal(a, 255);
});

function makeUniformPng(width: number, height: number, alpha: number): Buffer {
  const png = new PNG({ width, height });
  for (let i = 3; i < png.data.length; i += 4) {
    png.data[i] = alpha;
  }
  return PNG.sync.write(png);
}

test("isTileFullyTransparent: true when every pixel has alpha 0", () => {
  assert.equal(isTileFullyTransparent(makeUniformPng(4, 4, 0)), true);
});

test("isTileFullyTransparent: false when any pixel has alpha > 0", () => {
  const png = new PNG({ width: 4, height: 4 });
  for (let i = 3; i < png.data.length; i += 4) {
    png.data[i] = 0;
  }
  png.data[(4 * 2 + 2) * 4 + 3] = 255; // one opaque pixel in the middle
  assert.equal(isTileFullyTransparent(PNG.sync.write(png)), false);
});

test("transparentPixelRatio: returns the fraction of fully-transparent pixels", () => {
  assert.equal(transparentPixelRatio(makeUniformPng(4, 4, 0)), 1);
  assert.equal(transparentPixelRatio(makeUniformPng(4, 4, 255)), 0);

  const png = new PNG({ width: 4, height: 4 }); // 16 pixels, all alpha 0 by default
  for (let i = 0; i < 4; i++) {
    png.data[i * 4 + 3] = 255; // first 4 pixels opaque, remaining 12 stay transparent
  }
  assert.equal(transparentPixelRatio(PNG.sync.write(png)), 12 / 16);
});
