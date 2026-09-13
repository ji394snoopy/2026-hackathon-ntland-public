import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lonLatToGlobalPixel,
  globalPixelToLonLat,
  lonLatToTile,
  tileCenterLonLat,
} from "../../../src/mapTiles/detailTopo/nlscWmts.js";

test("globalPixelToLonLat: round-trips with lonLatToGlobalPixel for a known point", () => {
  const zoom = 15;
  const original = { lon: 121.4627, lat: 25.0111 };
  const pixel = lonLatToGlobalPixel(original.lon, original.lat, zoom);
  const roundTripped = globalPixelToLonLat(pixel.x, pixel.y, zoom);
  assert.ok(Math.abs(roundTripped.lon - original.lon) < 1e-6);
  assert.ok(Math.abs(roundTripped.lat - original.lat) < 1e-6);
});

test("tileCenterLonLat: returns a point that maps back to the same tile", () => {
  const zoom = 15;
  const tile = { z: zoom, x: 27439, y: 14031 };
  const { lon, lat } = tileCenterLonLat(tile);
  assert.deepEqual(lonLatToTile(lon, lat, zoom), tile);
});
