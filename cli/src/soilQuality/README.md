# soilQuality

Standalone CLI that reports the TARI (農業部農業試驗所) soil-map classification for a
新北市 (New Taipei City) lon/lat point — a factual proxy signal for the 自然條件「土質」
item in 表1 地價區段勘查表 (以該地價區段地質適宜作何種使用之內容來衡量, used only for
agricultural land valuation — not construction/building suitability). Unrelated to the
Claude/Bedrock PDF-extraction pipelines under `src/` — no Anthropic API calls, no PDF
input, just a public MOA (農業部) open-data download, following the same point-input
CLI convention as `src/drainageQuality/` and `src/windCondition/`.

## What this does — and doesn't — report

There is no public dataset that grades 土質 directly (優/稍優/普通/稍劣/劣 or a crop
suitability rating). This CLI reports **facts**, not a grade: the soil classification of
the polygon the query point falls in — soil series (Chinese/English), soil type, surface
texture code, soil order, slope-phase code, and related codes. The source dataset's own
field-spec document confirms there is no "suitable for X use" field to read off directly;
converting these classification facts into a suitability rating needs a sourced rule
this survey didn't find — left for a human appraiser, or a follow-up task, to interpret.

Two real "no match" outcomes are reported as-is, not smoothed over:

- The point falls inside a mapped polygon that isn't farmland at all (e.g. `土類`/`土型`
  = `建地`, built-up land) — a real, useful fact (this location isn't agricultural soil).
- The point falls in a genuine survey gap (dense urban areas in particular are often not
  covered) — reported as `soil: null`, with no "nearest surveyed polygon" fallback (see
  Known limitations).

## Commands

```bash
npm run fetch:soil -- <lon> <lat>
```

Examples:

```bash
npm run fetch:soil -- 121.5010 25.2590   # 三芝, New Taipei City — real farmland match
npm run fetch:soil -- 121.4627 25.0111   # 板橋, New Taipei City — urban 建地 match
```

## Coverage

**新北市 (New Taipei City) only**, hard error otherwise. Enforced by resolving the query
point's county through NLSC's keyless `TownVillagePointQuery` API (`resolveCity.ts`) —
the same proven approach `drainageQuality` uses. This is deliberately independent of the
soil-map dataset's own 地區 (county) field, which is unreliable for this purpose — see
next section.

## The dataset (`downloadSoilMap.ts` / `extractSoilMap.ts`)

Downloaded keyless from 農業資料開放平臺 (`data.moa.gov.tw`, dataset id `159`, 土壤圖):
one national SHP zip (73.8MB), TWD97 TM2 projection (EPSG:3826 — same projection math
`drainageQuality/projection.ts` already has), 57,646 `Polygon`/`MultiPolygon` features.

**The dataset's 地區 (county) field is not used for filtering.** Confirmed live while
surveying this data source: that field reflects each individual survey report's
*original* administrative boundary, not current ones — `新北市` never appears in it at
all; it's `臺北縣` (the pre-2010 name), plus combined labels like `臺北宜蘭`/`臺北桃園`
for reports spanning multiple counties. Filtering on it would silently drop real New
Taipei coverage. Instead, coverage is decided purely by point-in-polygon **containment**
against the full national feature set (`findSoilAtPoint.ts`) — a brute-force scan is
fast enough here (sub-second; ~7M total vertices estimated from file size) that no
bounding-box pre-filter is needed for a single query per CLI run.

The DBF is **BIG5-encoded**, not UTF-8 — confirmed live (UTF-8 decoding produced
mojibake Chinese text, BIG5 didn't). This differs from `drainageQuality`'s WRA layers,
which are UTF-8.

## Output

Printed to stdout and written to `src/soilQuality/output/result.json` (gitignored):

```json
{
  "lon": 121.501,
  "lat": 25.259,
  "ctyName": "新北市",
  "townName": "三芝區",
  "soil": {
    "seriesCode": "Ps",
    "seriesNameZh": "北新莊系",
    "seriesNameEn": "Peihsing Chuang",
    "soilType": "北新莊坋質粘壤土",
    "soilOrder": "安山岩黃壤",
    "surfaceTexture": "7",
    "slopePhase": "B",
    "otherPhase": "-",
    "soilVariation": "-",
    "surveyArea": "平地",
    "mapUnitName": "北新莊坋質粘壤土Ps7B",
    "areaSqm": 3996705.018
  }
}
```

`soil` is `null` when no polygon contains the query point (survey gap). Field codes
(`surfaceTexture`, `slopePhase`, `otherPhase`, `soilVariation`) are passed through raw,
undecoded — their legend lives in each individual soil-survey report, not in a universal
code table (confirmed from the source's own field-spec PDF), so decoding them is out of
scope here.

## Files

- `projection.ts` — WGS84 → TWD97 TM2 (EPSG:3826) reprojection. Duplicated from
  `drainageQuality/projection.ts` (confirmed identical projection parameters despite a
  different PROJCS vendor label in the two datasets' `.prj` files).
- `geometry.ts` — `pointInRing` (ray-casting) + `polygonContainsPoint`
  (exterior-ring-and-not-in-any-hole containment test). A trimmed, containment-only
  counterpart to `drainageQuality/geometry.ts` — this module never needs a
  nearest-exterior-edge distance, only a boolean.
- `resolveCity.ts` — `parseTownVillageXml` (pure XML field extraction) +
  `fetchTownVillage` (the live NLSC call). Duplicated from `drainageQuality/resolveCity.ts`
  unchanged.
- `downloadSoilMap.ts` — cache-aware fetch of the national soil-map zip
  (`cache/soilmap.zip`, gitignored, reused across runs). Resolves the download URL via
  MOA's file-listing API rather than a hardcoded zip URL, since that URL embeds a
  revision id (`RID=2953`) that could change on a future dataset update.
- `extractSoilMap.ts` — zip Buffer → parsed `SoilFeature[]` (`adm-zip` finds the
  `.shp`/`.dbf` entries by extension, since the zip's internal paths are BIG5-mojibake
  when read as UTF-8; `shapefile` parses them with `{ encoding: "big5" }`; DBF properties
  are normalized to strings).
- `findSoilAtPoint.ts` — brute-force containment scan across all national features,
  returning the first match's raw DBF fields curated into an English-keyed `SoilMatch`
  (dropping only internal/non-substantive fields — `圖幅名稱`, `MUID`/`Map_unit`,
  `Perimeter`/`Smfid` — and the unreliable `地區` field), or `null`.
- `main.ts` — CLI entrypoint: resolves the point's city (hard error if not 新北市),
  downloads/loads the cached soil map, reprojects the point once, finds the containing
  polygon, writes `output/result.json`.

## Known limitations

- **Facts, not a grade** — see "What this does — and doesn't — report" above.
- **No national "nearest" fallback for uncovered points** — when no polygon contains the
  query point, this CLI reports `soil: null` rather than searching the full national
  dataset for the closest surveyed polygon, which could return a misleadingly distant,
  unrelated match. A future task with a sourced maximum-useful-distance rule could add
  this back.
- **Single point, not parcel-polygon overlap** — like `mapTiles`/`drainageQuality`, this
  CLI takes one representative lon/lat, not a parcel boundary (none exists anywhere in
  this repo).
- **Cache is the raw zip only** — parsing (`extractSoilMap`) re-runs from the cached zip
  every invocation; not cached itself. A single run's parse of all 57,646 features takes
  a few seconds.
