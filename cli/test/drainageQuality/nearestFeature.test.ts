import { test } from "node:test";
import assert from "node:assert/strict";
import { filterToCounty, findNearestFeature } from "../../src/drainageQuality/nearestFeature.js";
import type { LayerFeature } from "../../src/drainageQuality/nearestFeature.js";
import type { DrainageLayer } from "../../src/drainageQuality/layers.js";

function pointFeature(name: string, county: string, coordinates: [number, number]): LayerFeature {
  return {
    properties: { NAME: name, ADMI_NAME: county },
    geometry: { type: "Point", coordinates },
  };
}

const POINT_LAYER: DrainageLayer = {
  wraCode: "PUMP_DRAIN",
  nameZh: "抽水站",
  nameEn: "pumpingStation",
  geometryKind: "point",
  countyField: "ADMI_NAME",
  displayNameField: "NAME",
};

const POLYGON_LAYER: DrainageLayer = {
  wraCode: "REGDAREA",
  nameZh: "中央管區域排水設施範圍",
  nameEn: "managedDrainageArea",
  geometryKind: "polygon",
  countyField: "COUN_NAME",
  displayNameField: "DRAIN_NAME",
};

const POLYLINE_LAYER: DrainageLayer = {
  wraCode: "rivdike",
  nameZh: "中央管河川河堤",
  nameEn: "riverDike",
  geometryKind: "polyline",
  countyField: "County",
  displayNameField: "Name",
};

test("filterToCounty: keeps an exact-match feature and a substring match in a delimited multi-county field, excludes a different county", () => {
  const features: LayerFeature[] = [
    pointFeature("溪美抽水站", "新北市三重區", [0, 0]), // ADMI_NAME-style city+district prefix
    {
      properties: { DRAIN_NAME: "塔寮坑溪", COUN_NAME: "新北市、桃園市" }, // "、"-delimited
      geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
    },
    pointFeature("某抽水站", "臺中市西區", [1, 1]), // different county
  ];

  const newTaipeiOnly = filterToCounty(features, "ADMI_NAME", "新北市");
  assert.equal(newTaipeiOnly.length, 1);
  assert.equal(newTaipeiOnly[0]!.properties.NAME, "溪美抽水站");

  const newTaipeiMultiCounty = filterToCounty(features, "COUN_NAME", "新北市");
  assert.equal(newTaipeiMultiCounty.length, 1);
  assert.equal(newTaipeiMultiCounty[0]!.properties.DRAIN_NAME, "塔寮坑溪");
});

test("findNearestFeature (point kind): returns the closer of two candidate point features", () => {
  const features: LayerFeature[] = [
    pointFeature("遠站", "新北市", [100, 0]),
    pointFeature("近站", "新北市", [1, 0]),
  ];
  const result = findNearestFeature(POINT_LAYER, features, [0, 0]);
  assert.equal(result?.name, "近站");
  assert.equal(result?.distanceMeters, 1);
});

test("findNearestFeature (polygon kind): returns inside:true, distanceMeters:0 when the point falls inside a candidate", () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];
  const features: LayerFeature[] = [
    {
      properties: { DRAIN_NAME: "某排水" },
      geometry: { type: "Polygon", coordinates: [square] },
    },
  ];
  const result = findNearestFeature(POLYGON_LAYER, features, [5, 5]);
  assert.equal(result?.name, "某排水");
  assert.equal(result?.inside, true);
  assert.equal(result?.distanceMeters, 0);
});

test("findNearestFeature (polyline kind): returns the distance to the nearest candidate line", () => {
  const features: LayerFeature[] = [
    {
      properties: { Name: "近堤" },
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
    },
    {
      properties: { Name: "遠堤" },
      geometry: { type: "LineString", coordinates: [[0, 100], [10, 100]] },
    },
  ];
  const result = findNearestFeature(POLYLINE_LAYER, features, [5, 5]);
  assert.equal(result?.name, "近堤");
  assert.equal(result?.distanceMeters, 5);
});

test("findNearestFeature: returns null when given an empty features array", () => {
  assert.equal(findNearestFeature(POINT_LAYER, [], [0, 0]), null);
});
