# windCondition

Standalone CLI that reports the typical wind character of a lon/lat point — average
daily-max wind speed and dominant wind direction over the past ~1 year — a factual
proxy signal for 「風勢」（自然條件 category：以該地價區段風勢方向或大小來衡量, in
表1 地價區段勘查表). Unrelated to the Claude/Bedrock PDF-extraction pipelines under
`src/` — no Anthropic API calls, no PDF input, just a public, keyless Open-Meteo HTTP
request, following the same point-input CLI convention as `src/mapTiles/` and
`src/drainageQuality/`.

## What this does — and doesn't — report

There is no public API that grades wind conditions directly (優/稍優/普通/稍劣/劣 or
otherwise). This CLI reports **facts**, not a grade: the average of the past year's
daily-max wind speed, and the dominant wind direction over that same year (as an 8-point
compass bucket with a Chinese label). Converting "18 km/h, mostly from the NE" into a
優劣等級 rating needs a sourced threshold rule this survey didn't find — left for a human
appraiser, or a follow-up task, to interpret.

The reported speed is honestly an **average of daily maximums**, not a true hourly mean
wind speed — see "Data source" below for why.

## Commands

```bash
npm run fetch:wind -- <lon> <lat>
```

Example:

```bash
npm run fetch:wind -- 121.4627 25.0111   # 板橋, New Taipei City
```

## Coverage

**Nationwide / global** — Open-Meteo has worldwide coverage, so no county restriction is
enforced (unlike `drainageQuality`'s 新北市-only gate, which exists only because WRA's
SHP layers are New-Taipei-specific data, not because of any limit in this module's own
data source).

## Data source (`fetchWindHistory.ts`)

Open-Meteo's Historical Weather (Archive) API
(`archive-api.open-meteo.com/v1/archive`), keyless, free, no registration — confirmed
live while surveying this module. Requests the `daily` aggregate block
(`windspeed_10m_max`, `winddirection_10m_dominant`) for a ~365-day window ending 7 days
before the run date (`dateRange.ts`'s `pastYearRange` — a safety buffer against the
archive's ERA5 ingestion lag/later revision, not a hard requirement observed live: data
for the current day was already present when this was surveyed).

The `daily` block only exposes the day's **maximum** wind speed, not a true mean — a
true hourly mean would require the `hourly` block (~8,760 rows/year) and averaging
client-side. This module averages the daily maximums instead (365 rows/year), trading
some statistical purity for a much smaller request and simpler client-side math — see
`temp/plans/wind-condition-cli.md`'s Decision Log for the tradeoff.

## Averaging (`windStats.ts`)

- `meanWindSpeed` — plain arithmetic mean of the daily-max speed values, skipping any
  `null` days.
- `circularMeanDirectionDeg` — direction is an angle, so a naive arithmetic mean breaks
  at the 0°/360° wraparound (mean of 350° and 10° should be ~0°, not 180°). Averages the
  sin/cos vector components of each day's dominant direction and converts back via
  `atan2` — standard meteorological practice for averaging wind direction.
- `compassBucket` — buckets the resulting mean angle into one of 8 points
  (N/NE/E/SE/S/SW/W/NW) with a Chinese label (e.g. `{ key: "NE", zh: "東北風" }`).

## Output

Printed to stdout and written to `src/windCondition/output/result.json` (gitignored):

```json
{
  "lon": 121.4627,
  "lat": 25.0111,
  "period": { "startDate": "2025-08-29", "endDate": "2026-08-28" },
  "sampleDays": 365,
  "avgDailyMaxWindSpeedKmh": 18.4,
  "dominantWindDirectionDeg": 62.1,
  "dominantWindDirectionCompass": { "key": "NE", "zh": "東北風" }
}
```

## Files

- `dateRange.ts` — `pastYearRange(today)`: pure function computing the `{startDate,
  endDate}` request window (past ~365 days, ending a 7-day buffer before `today`).
- `windStats.ts` — the three pure averaging/bucketing functions described above.
- `fetchWindHistory.ts` — `parseArchiveResponse` (pure JSON→array extraction) +
  `fetchWindHistory` (the live Open-Meteo call).
- `main.ts` — CLI entrypoint: parses `<lon> <lat>`, computes the date window, fetches
  the daily series, computes the averages, writes `output/result.json`.

## Known limitations

- **Facts, not a grade** — see "What this does — and doesn't — report" above.
- **Average of daily maxima, not a true mean wind speed** — see "Data source" above.
- **Single point, not parcel-polygon overlap** — like `mapTiles`/`drainageQuality`, this
  CLI takes one representative lon/lat, not a parcel boundary (none exists anywhere in
  this repo).
- **A missing/`null` day is silently skipped**, not surfaced — `sampleDays` in the output
  reflects the requested window length (usually 365), not how many days actually had
  non-null data.
