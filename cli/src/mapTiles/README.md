# mapTiles

Standalone CLI utilities for fetching NLSC (國土測繪中心) WMTS map tiles around a
lon/lat point, stitching them into one image, and marking the exact point with a pin.
Unrelated to the Claude/Bedrock PDF-extraction pipelines under `src/` — no Anthropic
API calls here, just public NLSC tile-server HTTP requests.

Two submodules, one per map product — see their own sections below for scope/coverage:
[`detailTopo`](#detailtopo--11000都市計畫地形圖) (1/1000, 新北市-only) and
[`baseTopo`](#basetopo--15000基本地形圖) (1/5000, nationwide layer, developed/verified
against 新北市).

## detailTopo — 1/1000都市計畫地形圖

Scoped to **新北市 (New Taipei City) only** — see [Coverage](#coverage) below.

### Commands

```bash
# 1/1000都市計畫地形圖 — 新北市-only sheets (auto-detects which New Taipei district
# layer covers the point; errors if the point falls outside New Taipei's coverage)
npm run fetch:topo -- <lon> <lat> [zoom] [radius] [pin] [emap]
```

Examples:

```bash
npm run fetch:topo -- 121.4627 25.0111 15 1              # 3x3 tiles, pin + plain white background (default)
npm run fetch:topo -- 121.4627 25.0111 15 1 off          # pin off, white background still on
npm run fetch:topo -- 121.4627 25.0111 15 1 on off       # pin on, background off (raw TOPO01K only, transparent gaps)
npm run fetch:topo -- 121.4627 25.0111 15 1 on on        # pin on, EMAP2 base layer instead of plain white
```

### Arguments

| Arg      | Required | Default          | Notes |
|----------|----------|------------------|-------|
| `lon`    | yes      | —                | Decimal degrees, e.g. `121.4627` |
| `lat`    | yes      | —                | Decimal degrees, e.g. `25.0111` |
| `zoom`   | no       | `15`             | 0-19; higher = finer detail, smaller ground area per tile |
| `radius` | no       | `0`              | Tile rings around the center point: `0` = single 256x256 tile, `1` = 3x3/768x768, `2` = 5x5/1280x1280, etc. |
| `pin`    | no       | on               | Pass `0`/`off`/`false`/`no` to disable the marker |
| `emap`   | no       | `white`          | `white` (default, plain white canvas, no EMAP2 fetch) / `on`\|`emap` (EMAP2 basemap underneath, see [Base layer](#base-layer-emap2) below) / `0`\|`off`\|`false`\|`no` (raw TOPO01K only, transparent gaps) |

### Output

Written to `src/mapTiles/detailTopo/output/` (gitignored, disposable) as
`<layer>-<zoom>-<centerTileX>-<centerTileY>[-r<radius>].png`.

### How centering and the pin work

`lonLatToTile` just floors to whichever tile contains the point — building a grid
around that tile alone can leave the point up to half a tile off-center. So
`fetchCenteredTileImage.ts` fetches one extra ring of tiles beyond the requested box,
stitches them (`stitchTiles.ts`), and crops to the exact pixel box centered on the
point before drawing the pin — rather than trusting the tile grid's own center to line
up with it. All of `nlscWmts.ts`'s tile math (`lonLatToGlobalPixel`, `lonLatToTile`,
tile URLs) works in the shared `GoogleMapsCompatible` (Web Mercator / EPSG:3857)
tile scheme every NLSC WMTS layer uses — 256x256 PNGs, zoom 0-19.

### Base layer (EMAP2)

TOPO01K tiles are drawn as line/label art on a **fully transparent** background —
`RGBA(0,0,0,0)`, not white — including on tiles where the layer genuinely has no
coverage at all. Some PNG viewers alpha-composite that onto white; others render the
raw RGB and show solid black. Either way, without a base layer those gaps carry no
information.

By default (`emap` = `white`), `fetchCenteredTileImage.ts` composites TOPO01K straight
onto a plain white canvas — no EMAP2 fetch at all.

Pass `emap on` (or `emap emap`) to instead fetch the same tile grid from NLSC's
**EMAP2** (臺灣通用電子地圖透明, "Taiwan general electronic map, transparent") layer —
a nationwide PNG basemap of roads/labels, itself also drawn with a transparent
background — and alpha-composite (`stitchTiles.ts`'s `compositeOver`, not
`PNG.bitblt`, since bitblt does a raw byte copy and would let a transparent TOPO01K
pixel clobber an opaque base pixel instead of blending) it underneath in this order:
EMAP2, then TOPO01K on top. TOPO01K's real content (mostly opaque where it has data)
covers the base wherever it exists; EMAP2 shows through everywhere it doesn't — useful
when you want the surrounding roads/labels for context instead of a blank background.

Pass `emap off` to skip compositing altogether and get raw TOPO01K only (transparent
gaps, subject to the neighbor-layer gap fill below, which forces a white canvas
regardless of `emap` whenever it finds a patch to apply).

### Neighboring-layer gap fill

A district's TOPO01K sheet only has real content near its own coverage — if the query
point sits near that sheet's edge, part of the requested grid can be genuinely empty
(see "Base layer" above), leaving only a blank canvas (or EMAP2's generic basemap, if
`emap on`) there. To do better, `fetchCenteredTileImage.ts` checks each *raw fetched
primary-layer tile*'s alpha channel (`stitchTiles.ts`'s `isTileFullyTransparent` — a
genuine no-coverage tile is uniformly `alpha=0`, confirmed against live data) and, for
**each individual blank tile**, looks up which other 新北市 layer covers *that tile's own
center coordinate* — `layers.ts`'s `rankLayersCoveringPoint`, the same point-containment
+ newest-survey-year logic `findLayerForPoint` uses to pick the primary layer in the
first place, just applied per-tile instead of once for the whole grid. Candidates are
tried newest-year-first, one single-tile fetch at a time, until one actually has content
(`isTileFullyTransparent` again) — falling through to the next candidate if it doesn't.
Different blank tiles can resolve to different neighboring layers, correctly filling a
grid that spans more than one district's real boundary. This always runs when a gap
exists — no CLI toggle. The common case (no gap) costs nothing extra.

This design replaced an earlier whole-grid version (rank candidates by bbox-overlap
against the *entire* requested grid, try the top few as whole-grid fetches) after it was
caught live picking an empty layer: TOPO01K bboxes are far looser than real coverage
(see the note below), so a single grid-wide bbox-overlap check pulled in ~25 candidates
for one request, and the newest-year one had zero real content while the true neighbor,
with an older survey year, sat 6 positions down and was never tried. Per-tile point
lookups reuse the exact mechanism already trusted for the primary layer instead of a
separate, looser box-based heuristic, and since each attempt is a single 256x256 tile
fetch rather than a whole grid, there's no need to cap how many candidates get tried.

### Files

All implementation lives under `detailTopo/` — the submodule for this pipeline's
one supported map product, 1/1000都市計畫地形圖 (New Taipei only). `baseTopo/` is
the sibling submodule for 1/5000基本地形圖 — see its own [Files](#files-1) below.

- `detailTopo/nlscWmts.ts` — WMTS URL building, lon/lat → tile/pixel math
  (including the inverse `globalPixelToLonLat` and per-tile `tileCenterLonLat`),
  raw tile fetching.
- `detailTopo/stitchTiles.ts` — composites a tile grid into one PNG, alpha-blends
  a base layer underneath (`compositeOver`, `createBlankCanvas`), detects empty
  tiles (`isTileFullyTransparent`), crops to a pixel box, draws the pin marker
  (`pngjs`, no native dependencies).
- `detailTopo/layers.ts` — pure New-Taipei-layer selection logic shared by
  `main.ts` and `fetchCenteredTileImage.ts`: `parseLayerBounds`,
  `isNewTaipeiLayer`, `parseSurveyYear`, `findLayerForPoint` (primary layer for
  the query point), `rankLayersCoveringPoint` (candidate layers for one blank
  tile's own coordinate, newest-year-first).
- `detailTopo/fetchCenteredTileImage.ts` — orchestrates the above into a
  pixel-precise, optionally-marked, optionally-EMAP2-backed, per-tile-gap-filled
  image for a given lon/lat/zoom/radius.
- `detailTopo/main.ts` — CLI entrypoint; fetches `GetCapabilities`, filters to
  New Taipei layers, picks the primary layer, and wires everything into
  `fetchCenteredTileImage.ts`.

### Coverage

This CLI only supports **新北市 (New Taipei City)** — `findLayerForPoint` is given only
the layers whose `GetCapabilities` title starts with `新北市` (`isNewTaipeiLayer`), out
of TOPO01K's ~413 nationwide per-city sheets. A point outside New Taipei's coverage
errors rather than falling back to another city/county.

Record of what a live `GetCapabilities` fetch returned as of 2026-09-03: **56 layers**,
ids `TOPO01K_F01`–`TOPO01K_F56`, titled `新北市<地區>...`. Most of New Taipei's 29
districts have two overlapping layers published under different title styles:

- `新北市<district>都市計畫_<NN>年` — an older 都市計畫 (urban-plan) sheet.
- `新北市<district>區(<NNN>年修測)` — a newer per-district resurvey sheet.

When a point falls inside more than one candidate layer's bounding box,
`findLayerForPoint` picks the one with the highest year parsed out of its title
(`parseSurveyYear`, regex `/(\d+)年/` — matches both title styles), so the resurvey
sheet wins over the older plan sheet wherever both exist.

Note: NLSC's published bounding boxes for individual TOPO01K layers are looser than
their actual district coverage — some (e.g. `新北市蘆洲區(110年修測)`) span several
degrees of longitude, well beyond 蘆洲's real extent — so more than one 新北市 layer
commonly "covers" the same point per its bbox even when only one sheet actually has
real imagery there. The year tie-break only disambiguates among bbox matches; it
doesn't tighten the bbox check itself.

## baseTopo — 1/5000基本地形圖

### Commands

```bash
# 1/5000基本地形圖 (B5000, NLSC's nationwide merged layer) — no per-district lookup
npm run fetch:base -- <lon> <lat> [zoom] [radius] [pin] [emap]
```

Examples:

```bash
npm run fetch:base -- 121.4627 25.0111 15 1              # 3x3 tiles, pin + plain white background (default)
npm run fetch:base -- 121.4627 25.0111 15 1 off          # pin off, white background still on
npm run fetch:base -- 121.4627 25.0111 15 1 on off       # pin on, background off (raw B5000 only, transparent gaps)
npm run fetch:base -- 121.4627 25.0111 15 1 on on        # pin on, EMAP2 base layer instead of plain white
```

### Arguments

| Arg      | Required | Default          | Notes |
|----------|----------|------------------|-------|
| `lon`    | yes      | —                | Decimal degrees, e.g. `121.4627` |
| `lat`    | yes      | —                | Decimal degrees, e.g. `25.0111` |
| `zoom`   | no       | `15`             | 0-19; higher = finer detail, smaller ground area per tile |
| `radius` | no       | `0`              | Tile rings around the center point: `0` = single 256x256 tile, `1` = 3x3/768x768, `2` = 5x5/1280x1280, etc. |
| `pin`    | no       | on               | Pass `0`/`off`/`false`/`no` to disable the marker |
| `emap`   | no       | `white`          | `white` (default, plain white canvas, no EMAP2 fetch) / `on`\|`emap` (EMAP2 basemap underneath) / `0`\|`off`\|`false`\|`no` (raw B5000 only, transparent gaps) |

### Output

Written to `src/mapTiles/baseTopo/output/` (gitignored, disposable) as
`B5000-<zoom>-<centerTileX>-<centerTileY>[-r<radius>].png`.

### Why this submodule is simpler than detailTopo

NLSC's `TOPO05K` `GetCapabilities` lists one nationwide merged layer, `B5000`
("1/5000基本地形圖(全)"), plus per-year snapshots (`TOPO05K_111`, `TOPO05K_110`, ...).
Unlike `detailTopo`'s `TOPO01K` (~413 nationwide sheets, one per city/county, each with
its own bounding box), `B5000` is a single fixed layer id — `main.ts` passes the
constant `"B5000"` straight through, with no `GetCapabilities` fetch, no `layers.ts`
equivalent, and no per-tile neighbor-layer gap fill at all. Compositing onto a plain
white canvas (default) or the optional EMAP2 basemap (same rationale as
[detailTopo's](#base-layer-emap2) — `B5000` tiles are also drawn as line/label art on a
fully transparent background) is the only gap-filling this submodule does.

### Coverage

Developed and live-verified against **新北市 (New Taipei City)** points (Banqiao,
Sanchong, Tamsui, Xindian, Tucheng) — `B5000` returned real (non-blank) content through
zoom 19 at all of them. Unlike `detailTopo`, there's no hard coverage restriction: since
`B5000` is one nationwide mosaic with no natural "New Taipei-only" bounding box to check
a point against, a point outside New Taipei isn't rejected — it just isn't part of this
submodule's tested/verified area, and tile availability at high zoom outside New Taipei
hasn't been confirmed (a spot-check found `B5000` blank past zoom 13 in central Taipei
City, for example, despite full coverage at nearby New Taipei points).

### Files

All implementation lives under `baseTopo/` — the submodule for 1/5000基本地形圖.
`nlscWmts.ts` and `stitchTiles.ts` are byte-for-byte copies of `detailTopo`'s (both are
already layer-agnostic — layer id is a parameter, not a constant — so duplicating them
keeps each submodule under `src/mapTiles/` fully self-contained rather than sharing a
module between them).

- `baseTopo/nlscWmts.ts` — WMTS URL building, lon/lat → tile/pixel math, raw tile
  fetching. Identical to `detailTopo/nlscWmts.ts`.
- `baseTopo/stitchTiles.ts` — composites a tile grid into one PNG, alpha-blends a base
  layer underneath, crops to a pixel box, draws the pin marker. Identical to
  `detailTopo/stitchTiles.ts`.
- `baseTopo/fetchCenteredTileImage.ts` — orchestrates the above into a pixel-precise,
  optionally-marked, optionally-EMAP2-backed image for a given lon/lat/zoom/radius.
  Simpler than `detailTopo`'s version: one fixed primary layer, no per-tile
  neighbor-layer gap fill.
- `baseTopo/main.ts` — CLI entrypoint; passes the fixed layer id `"B5000"` straight
  into `fetchCenteredTileImage.ts` — no `GetCapabilities` call.
