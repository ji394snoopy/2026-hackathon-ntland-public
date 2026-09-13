# environmentalPollution

Five standalone CLIs (each its own sub-folder + `main.ts`, one npm script apiece) that
report the nearest-to-a-point facts for the five sub-items under 環境污染 in the
regional-factors survey — a factual proxy for `proximityToPollutionSource`
(`references/factor-standard.json`'s `regionalFactors.environmentalPollution` category),
not a 優劣等級 grade. Unlike the Claude/Bedrock PDF-extraction pipelines under `src/`, no
Anthropic API calls, no PDF input — public HTTP requests to 環境部
(data.moenv.gov.tw)'s open-data API, following the same point-input CLI convention as
`src/mapTiles/`, `src/drainageQuality/`, `src/windCondition/`, `src/soilQuality/`, and
`src/osmFacilities/`.

**Requires a free `MOENV_API_KEY`** — every dataset here 404s/500s without one (confirmed
live; there's no keyless tier). Register at https://data.moenv.gov.tw/api-term, then add
`MOENV_API_KEY=...` to your `.env` (see `.env.example`) — each sub-CLI's `main.ts` calls
`process.loadEnvFile()` at startup, so it's picked up automatically.

## Commands

```bash
npm run fetch:air -- <lon> <lat>                # 廢氣污染 — nearest AQI station
npm run fetch:water -- <lon> <lat>              # 水污染 — nearest river water-quality station + latest reading
npm run fetch:noise -- <lon> <lat>              # 噪音污染 — nearest noise-monitoring station
npm run fetch:soil-contamination -- <lon> <lat> # 其他污染 — nearest soil/groundwater contamination site
npm run fetch:waste-dumping -- <lon> <lat>      # 廢棄物污染 — nearest controlled waste-dumping site
```

All five are nationwide (no county restriction) — 環境部's datasets aren't 新北市-only
the way WRA's drainage layers or TARI's soil map are.

## Shared infrastructure

Two files at this folder's root are genuinely dataset-agnostic and used by every
sub-CLI below — the only place in this repo where standalone-CLI sub-folders share code
with each other (`mapTiles/detailTopo/` and `mapTiles/baseTopo/`, and `districtSurvey/`'s
eight categories, deliberately don't). Justified here the same way `src/shared/` is
justified for the Bedrock pipelines: both files are real infrastructure (an API client,
a distance calculation), not case-specific business logic that only looks identical by
coincidence.

- `moenvClient.ts` — `buildMoenvUrl`/`readMoenvApiKey`/`parseMoenvArrayResponse` (pure,
  unit-tested) + `queryMoenvDataset`/`queryMoenvDatasetPaginated` (live fetch). Every
  dataset used here returns a bare top-level JSON array — confirmed live against 4
  different datasets, not assumed from the platform's docs (which don't specify a
  response schema at all). **The API caps `limit` at 1000 rows per request regardless of
  what's asked for** (confirmed live: requesting 2500 returns exactly 1000) —
  `queryMoenvDatasetPaginated` loops offset-based pages for any dataset that might
  exceed that (`ems_s_07` has 2000+ sites; a single-page fetch silently truncated it
  during development, found by live-testing, not by code review). A bad/expired key
  returns a non-JSON body (a Chinese message directly prefixed to a JSON blob, e.g.
  `該 API KEY 不存在或是已經到期。{...}`) — `parseMoenvArrayResponse` surfaces that text
  directly in a clear error rather than a bare `SyntaxError`.
- `nearestPoint.ts` — `findNearestPoint` (haversine-based, generic over any
  `{lon,lat,record}` candidate list), used by all five sub-CLIs' nearest-station/site
  lookup.

## The five sub-CLIs

- **`airPollution/`** — `aqx_p_432` (空氣品質指標 AQI), 84 stations nationwide, fits in
  one request. Reports the nearest station's `aqi`/`status`/`pollutant`/`publishtime`.
- **`waterPollution/`** — two datasets, joined client-side:
  `WQX_P_06` (河川水質測點基本資料, 446 stations — station list + coordinates) finds the
  nearest station; `WQX_P_01` (河川水質監測資料, per-item measurements — one row per
  site×date×measured-item, **not** a pre-computed score) supplies the actual reading,
  including a real `RPI`-abbreviated item (河川污染分類指標) among the ~15-30 items per
  sampling date. `WQX_P_01` has **no working `siteid`/`itemname` filter** (confirmed
  live — both are silently ignored server-side), so `parseReadings.ts` fetches a
  paginated recent-sorted window (30 pages / ~30,000 rows, confirmed live to be needed:
  a single 1000-row page only covers ~4 days and ~31 of 446 stations, since sampling
  frequency varies per station) and filters client-side. If the nearest station still
  isn't in that window, `latestReading` is `null` and `readingUnavailableInFetchedWindow`
  is `true` — an honest gap, not silently reported as "no station nearby."
- **`noisePollution/`** — `NOS_P_08` (噪音監測站資料), 320 stations nationwide, fits in
  one request. Reports the nearest station's `noisetype`/`areatype`/`address`/
  `sideroad`/`sideroadwidth`.
- **`soilGroundwaterContamination/`** — `ems_s_07` (土壤及地下水污染場址基本資料),
  2000+ sites nationwide (needs `queryMoenvDatasetPaginated`, confirmed live — see
  above). Coordinates come directly from the dataset's own `wgs84_lng`/`wgs84_lat`
  fields, no reprojection needed. Reports the nearest site's `site_type`/`site_use`/
  `pollutant`/`controltype`/`anno_date`/`sitearea`.
- **`wasteDumping/`** — structurally different from the other four: `wr_p_244`
  (列管廢棄物棄置場址) isn't a records API, it's a catalog of periodic
  `WDMS-WGS84-<date>.zip` snapshots (confirmed live). `downloadSnapshot.ts` fetches the
  catalog via `moenvClient`, takes the newest entry, downloads and caches its zip (same
  `AdmZip` + `shapefile` pattern as `drainageQuality`/`soilQuality`, cached to
  `wasteDumping/cache/` by filename). `extractSites.ts` reads the nested `.shp`/`.dbf`
  with `encoding: "big5"` — confirmed live via the zip's own `.cpg` sidecar; the only
  shapefile source in this repo that isn't UTF-8. 466 nationwide point features.
  Reports the nearest site's `wasteKind`/`lastUpdated`/`soilWaterControlled`/
  `siteStatus`.

## Output

Each sub-CLI prints to stdout and writes its own `<subfolder>/output/result.json`
(gitignored), shaped as `{ center: {lon, lat}, nearest<Station|Site>: {record, metersToCenter} | null }`
— `waterPollution` additionally includes `latestReading` and
`readingUnavailableInFetchedWindow`.

## Known limitations

- **Facts, not a grade** — same philosophy as `windCondition`/`drainageQuality`/
  `soilQuality`: these report station/site facts near a point, not a computed 優劣等級.
- **`waterPollution`'s reading can be genuinely unavailable** for a station not sampled
  within the fetched window — see above. A larger `READINGS_MAX_PAGES` in
  `waterPollution/main.ts` improves coverage at the cost of more requests/runtime.
- **Single point, not parcel-polygon overlap** — like every other CLI in this repo, one
  representative lon/lat, not a parcel boundary.
- **Every dataset here is a snapshot at fetch time** — no historical/trend data is
  reported, only whatever MOENV's platform currently serves as "current."
