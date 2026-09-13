import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBaseLayerMode } from "../../../src/mapTiles/baseTopo/main.js";

test("parseBaseLayerMode: defaults to white when no arg given", () => {
  assert.equal(parseBaseLayerMode(undefined), "white");
});

test("parseBaseLayerMode: 'on' and unrecognized values fall back to emap", () => {
  assert.equal(parseBaseLayerMode("on"), "emap");
  assert.equal(parseBaseLayerMode("EMAP"), "emap");
});

test("parseBaseLayerMode: recognizes 'white' case-insensitively", () => {
  assert.equal(parseBaseLayerMode("white"), "white");
  assert.equal(parseBaseLayerMode("WHITE"), "white");
});

test("parseBaseLayerMode: recognizes the off-aliases case-insensitively", () => {
  for (const value of ["0", "off", "false", "no", "OFF", "False"]) {
    assert.equal(parseBaseLayerMode(value), "off");
  }
});
