import { test } from "node:test";
import assert from "node:assert/strict";
import { findSoilAtPoint } from "../../src/soilQuality/findSoilAtPoint.js";
import type { SoilFeature } from "../../src/soilQuality/findSoilAtPoint.js";
import type { Point } from "../../src/soilQuality/geometry.js";

function squareRing(originX: number, originY: number, size: number): Point[] {
  return [
    [originX, originY],
    [originX + size, originY],
    [originX + size, originY + size],
    [originX, originY + size],
    [originX, originY],
  ];
}

function makeFeature(overrides: Partial<Record<string, string>> = {}): SoilFeature {
  return {
    properties: {
      "圖幅名稱": "-",
      "地區": "臺北縣",
      "調查區": "平地",
      MUID: "1120042609621",
      Map_unit: "Bsk2C",
      "繪圖單位名": "沙港砂質壤土Bsk2C",
      "土類": "黃紅色崩積土",
      "土系代號": "Bsk",
      "土系": "沙港系",
      Series: "Sha Kang Series",
      "土型": "沙港砂質壤土",
      "表土質地": "2",
      "坡度相": "C",
      "土相": "-",
      "土壤變異": "-",
      AREA: "124498.797",
      Perimeter: "2136.18",
      ...overrides,
    },
    geometry: { type: "Polygon", coordinates: [squareRing(0, 0, 10)] },
  };
}

test("findSoilAtPoint: returns the curated soil facts for a point inside a feature's polygon", () => {
  const features = [makeFeature()];
  const match = findSoilAtPoint(features, [5, 5]);
  assert.deepEqual(match, {
    seriesCode: "Bsk",
    seriesNameZh: "沙港系",
    seriesNameEn: "Sha Kang Series",
    soilType: "沙港砂質壤土",
    soilOrder: "黃紅色崩積土",
    surfaceTexture: "2",
    slopePhase: "C",
    otherPhase: "-",
    soilVariation: "-",
    surveyArea: "平地",
    mapUnitName: "沙港砂質壤土Bsk2C",
    areaSqm: 124498.797,
  });
});

test("findSoilAtPoint: returns null when the point falls outside every feature (no survey coverage)", () => {
  const features = [makeFeature()];
  const match = findSoilAtPoint(features, [500, 500]);
  assert.equal(match, null);
});

test("findSoilAtPoint: areaSqm in the returned match is a parsed number, not a string", () => {
  const features = [makeFeature({ AREA: "1000.5" })];
  const match = findSoilAtPoint(features, [5, 5]);
  assert.equal(typeof match?.areaSqm, "number");
  assert.equal(match?.areaSqm, 1000.5);
});
