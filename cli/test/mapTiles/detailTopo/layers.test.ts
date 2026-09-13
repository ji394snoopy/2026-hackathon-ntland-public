import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isNewTaipeiLayer,
  parseSurveyYear,
  findLayerForPoint,
  rankLayersCoveringPoint,
} from "../../../src/mapTiles/detailTopo/layers.js";

test("isNewTaipeiLayer: true for a title starting with 新北市, false otherwise", () => {
  assert.equal(
    isNewTaipeiLayer({
      id: "TOPO01K_F01",
      title: "新北市三峽都市計畫_105年",
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
    }),
    true,
  );
  assert.equal(
    isNewTaipeiLayer({
      id: "TOPO01K_O01",
      title: "新竹市都市計畫",
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
    }),
    false,
  );
});

test("parseSurveyYear: extracts the year from both title styles", () => {
  assert.equal(parseSurveyYear("新北市三峽都市計畫_105年"), 105);
  assert.equal(parseSurveyYear("新北市三峽區(111年修測)"), 111);
});

test("parseSurveyYear: throws when the title has no parsable year", () => {
  assert.throws(() => parseSurveyYear("新北市三峽都市計畫"));
});

const OLDER_SANXIA_PLAN = {
  id: "TOPO01K_F01",
  title: "新北市三峽都市計畫_105年",
  minX: -10,
  minY: -10,
  maxX: 10,
  maxY: 10,
};
const NEWER_SANXIA_RESURVEY = {
  id: "TOPO01K_F33",
  title: "新北市三峽區(111年修測)",
  minX: -10,
  minY: -10,
  maxX: 10,
  maxY: 10,
};
const POINT_INSIDE_BOTH = { lon: 0, lat: 0 }; // web-mercator (0,~0) falls in [-10,10]x[-10,10]

test("findLayerForPoint: picks the higher survey year regardless of array order", () => {
  const older = findLayerForPoint(
    [OLDER_SANXIA_PLAN, NEWER_SANXIA_RESURVEY],
    POINT_INSIDE_BOTH.lon,
    POINT_INSIDE_BOTH.lat,
  );
  assert.equal(older?.id, "TOPO01K_F33");

  const reversed = findLayerForPoint(
    [NEWER_SANXIA_RESURVEY, OLDER_SANXIA_PLAN],
    POINT_INSIDE_BOTH.lon,
    POINT_INSIDE_BOTH.lat,
  );
  assert.equal(reversed?.id, "TOPO01K_F33");
});

test("findLayerForPoint: returns undefined when no candidate layer covers the point", () => {
  const farAway = {
    id: "TOPO01K_F02",
    title: "新北市三芝都市計畫_104年",
    minX: 1000,
    minY: 1000,
    maxX: 1010,
    maxY: 1010,
  };
  assert.equal(findLayerForPoint([farAway], 0, 0), undefined);
});

test("scoping: filtering to isNewTaipeiLayer before findLayerForPoint excludes a covering non-新北市 layer", () => {
  const hsinchuLayer = {
    id: "TOPO01K_O01",
    title: "新竹市都市計畫",
    minX: -10,
    minY: -10,
    maxX: 10,
    maxY: 10,
  };
  const newTaipeiLayers = [hsinchuLayer, OLDER_SANXIA_PLAN].filter(isNewTaipeiLayer);
  const layer = findLayerForPoint(newTaipeiLayers, 0, 0);
  assert.equal(layer?.id, "TOPO01K_F01");
});

const PRIMARY = {
  id: "TOPO01K_F35",
  title: "新北市中和區(112年修測)",
  minX: -5,
  minY: -5,
  maxX: 5,
  maxY: 5,
};
const POINT = { lon: 0, lat: 0 }; // web-mercator (0,~0)

test("rankLayersCoveringPoint: returns point-covering candidates sorted newest-year-first, excluding the primary", () => {
  const oldest = {
    id: "TOPO01K_F12",
    title: "新北市板橋都市計畫_103年",
    minX: -10,
    minY: -10,
    maxX: 10,
    maxY: 10,
  };
  const middle = {
    id: "TOPO01K_F43",
    title: "新北市板橋區(109年修測)",
    minX: -10,
    minY: -10,
    maxX: 10,
    maxY: 10,
  };
  const newest = {
    id: "TOPO01K_F38",
    title: "新北市永和區(112年修測)",
    minX: -10,
    minY: -10,
    maxX: 10,
    maxY: 10,
  };
  const result = rankLayersCoveringPoint(
    [PRIMARY, oldest, newest, middle],
    PRIMARY.id,
    POINT.lon,
    POINT.lat,
  );
  assert.deepEqual(
    result.map((layer) => layer.id),
    ["TOPO01K_F38", "TOPO01K_F43", "TOPO01K_F12"],
  );
});

test("rankLayersCoveringPoint: returns an empty array when no other candidate covers the point", () => {
  const farAway = {
    id: "TOPO01K_F02",
    title: "新北市三芝都市計畫_104年",
    minX: 1000,
    minY: 1000,
    maxX: 1010,
    maxY: 1010,
  };
  const result = rankLayersCoveringPoint([PRIMARY, farAway], PRIMARY.id, POINT.lon, POINT.lat);
  assert.deepEqual(result, []);
});
