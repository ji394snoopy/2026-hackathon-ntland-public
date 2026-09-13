# drainageQuality

Standalone CLI that reports nearby WRA (經濟部水利署) drainage infrastructure for a
新北市 (New Taipei City) lon/lat point — a factual proxy signal for 保（排）水之良否
(item key `drainageQuality` in `references/zh_en_item_mapping.json`, part of the
自然條件 category, weight 2/5, in 表1 地價區段勘查表). Unrelated to the Claude/Bedrock
PDF-extraction pipelines under `src/` — no Anthropic API calls, no PDF input, just
public WRA/NLSC HTTP requests, following the same point-input CLI convention as
`src/mapTiles/`.

## What this does — and doesn't — report

There is no public API that grades drainage quality directly (優/稍優/普通/稍劣/劣 or
otherwise). This CLI reports **facts**, not a grade: for each of 4 WRA drainage-facility
layers, the nearest New Taipei feature and its distance from the query point (plus
inside/outside for the one polygon layer). Converting "230m from a pumping station" into
a 優劣等級 rating needs a sourced threshold rule this survey didn't find — left for a
human appraiser, or a follow-up task, to interpret.

淹水潛勢 (flood-inundation-potential simulation data) is deliberately **not** used here —
this module is about drainage infrastructure/capacity, not flood-hazard simulation.

## Commands

```bash
npm run fetch:drainage -- <lon> <lat>
```

Example:

```bash
npm run fetch:drainage -- 121.4627 25.0111   # 板橋, New Taipei City
```

## Coverage

**新北市 (New Taipei City) only**, hard error otherwise. Enforced by resolving the query
point's county through NLSC's keyless `TownVillagePointQuery` API
(`resolveCity.ts`) — confirmed live to correctly distinguish 新北市 from every other
county, including its immediate neighbor 臺北市. Unlike `mapTiles/detailTopo`, there's
no per-district boundary layer to bounding-box against for this domain, so the city name
returned by that API is the coverage check.

## The 4 layers (`layers.ts`)

All 4 are downloaded keyless from WRA's 水利空間資訊服務平台
(`gic.wra.gov.tw/gis/gic/API/Google/DownLoad.aspx?fname=<code>&filetype=SHP`), nationwide
SHP zips, filtered down to 新北市 features locally:

| WRA code     | 中文名稱               | Kind     | Meaning |
|--------------|------------------------|----------|---------|
| `PUMP_DRAIN` | 抽水站                 | point    | Pumping station |
| `DIKEGATE`   | 水門                   | point    | Floodgate |
| `REGDAREA`   | 中央管區域排水設施範圍 | polygon  | Boundary of a centrally-managed regional drainage area |
| `rivdike`    | 中央管河川河堤         | polyline | River dike / revetment |

Excluded from this catalog (surveyed but out of scope): 淹水潛勢圖 (flood-simulation
data, per explicit scope decision), map-sheet index frames (`drframe`/`rvframe`/
`emframe` — not facility data), general river-zone/seawall layers (not drainage-specific
or coastal/out-of-scope).

## Output

Printed to stdout and written to `src/drainageQuality/output/result.json` (gitignored):

```json
{
  "lon": 121.4627,
  "lat": 25.0111,
  "ctyName": "新北市",
  "townName": "板橋區",
  "results": [
    { "layer": "pumpingStation", "layerZh": "抽水站", "nearest": { "name": "四汴頭抽水站", "distanceMeters": 1887.1 } },
    { "layer": "floodgate", "layerZh": "水門", "nearest": { "name": "四汴頭水門", "distanceMeters": 1924.4 } },
    { "layer": "managedDrainageArea", "layerZh": "中央管區域排水設施範圍", "nearest": { "name": "塔寮坑溪", "distanceMeters": 2554.0, "inside": false } },
    { "layer": "riverDike", "layerZh": "中央管河川河堤", "nearest": { "name": "板橋堤防", "distanceMeters": 1919.9 } }
  ]
}
```

`nearest` is `null` if a layer has no 新北市 features at all (shouldn't happen for these
4 — each has confirmed New Taipei coverage — but is handled rather than assumed). Only
the polygon layer (`managedDrainageArea`) ever carries `inside: true` — a query point
inside a managed drainage area's boundary reports `distanceMeters: 0`.

## Files

- `projection.ts` — WGS84 → TWD97 TM2 (EPSG:3826) reprojection, shared by all 4 layers
  (confirmed identical projection parameters across all 4 layers' `.prj` files despite
  differing vendor labels). Reprojects the query point once, not every feature vertex.
- `geometry.ts` — pure distance/containment helpers: point-to-point, point-to-segment,
  point-in-ring (ray-casting, hole-aware for containment), polygon distance
  (inside-or-nearest-exterior-edge), polyline distance (nearest point on any segment).
  Normalizes `Polygon`→`MultiPolygon` and `LineString`→`MultiLineString` internally so a
  single- or multi-part shape takes the same code path.
- `resolveCity.ts` — `parseTownVillageXml` (pure XML field extraction) +
  `fetchTownVillage` (the live NLSC call).
- `layers.ts` — the 4 layer definitions (WRA code, geometry kind, county field, name
  field) — static config, no I/O.
- `nearestFeature.ts` — `filterToCounty` (substring match on a layer's own county field)
  + `findNearestFeature` (dispatches on geometry kind to the right `geometry.ts` helper).
- `downloadLayer.ts` — cache-aware fetch of a layer's SHP zip (`cache/<code>.zip`,
  gitignored, reused across runs).
- `extractLayer.ts` — zip Buffer → parsed features (`adm-zip` finds the `.shp`/`.dbf`
  entries by extension, since each layer's zip nests them at a different internal path;
  `shapefile` parses them; DBF properties are normalized to strings).
- `main.ts` — CLI entrypoint: resolves the point's city (hard error if not 新北市),
  reprojects it once, loops the 4 layers, writes `output/result.json`.

## Known limitations

- **Facts, not a grade** — see "What this does — and doesn't — report" above.
- **Single point, not parcel-polygon overlap** — like `mapTiles`, this CLI takes one
  representative lon/lat, not a parcel boundary (none exists anywhere in this repo).
- **Polygon distance uses exterior rings only, not holes** — a query point outside a
  `REGDAREA` polygon but inside one of its holes is correctly treated as "outside" for
  containment, but the reported distance is to the exterior ring, not the (possibly
  closer) hole boundary.
- **Cache is raw zips only** — parsing (`extractLayer`) re-runs from the cached zip
  every invocation; not cached itself.
