# osmFacilities

Standalone CLI that queries the public OpenStreetMap Overpass API for features matching
one or more arbitrary OSM tags (`key=value`) within a radius of a lon/lat point, sorted
by distance — a general-purpose "try this tag" tool for scouting which OSM tags actually
have coverage near a given point, ahead of building a dedicated pipeline around them (see
`references/regionalFactors-fillable.md` for the 工商活動/公共建設/特殊設施 items this was
built to explore: 百貨公司, 娛樂設施, 展演中心, 觀光飯店, etc.). Unrelated to the
Claude/Bedrock PDF-extraction pipelines under `src/` — no Anthropic API calls, no PDF
input, just a public, keyless Overpass HTTP request, following the same point-input CLI
convention as `src/mapTiles/`, `src/drainageQuality/`, `src/windCondition/`, and
`src/soilQuality/`.

## Commands

```bash
npm run fetch:osm -- <lon> <lat> <tag1=value1,tag2=value2,...> [radiusMeters]
```

Example:

```bash
npm run fetch:osm -- 121.636 25.221 shop=department_store,amenity=cinema,tourism=hotel
```

`radiusMeters` defaults to 5000 if omitted — Overpass's cost driver is result count, not
radius, and 5km came back in a few seconds even for a dense tag (317 banks around 板橋 in
~3.5s), so there's no need to keep it small.

## Coverage

**Nationwide / global** — Overpass queries the full OpenStreetMap dataset, so there's no
county restriction (unlike `drainageQuality`/`soilQuality`'s 新北市-only gate, which
exists only because those data sources are New-Taipei-specific).

## Data source (`queryOverpass.ts`)

The public Overpass API (`overpass-api.de/api/interpreter`), keyless, free, no
registration. One Overpass QL request is sent **per tag** (`buildOverpassQuery.ts`),
rather than one combined query for every tag — so an unsupported or misspelled tag only
fails its own lookup, not the whole run. This isolation is enforced at two levels:
`queryOverpass`'s retry counter is a fresh local variable on every call, so each tag
always gets its own full `MAX_RETRIES` budget regardless of what happened on a previous
tag; and `main.ts`'s per-tag loop catches a tag that still fails after exhausting
retries, warns, and continues to the remaining tags rather than crashing the whole run —
failed tags are reported in the output's `failedTags` array instead of losing every
other tag's results with them.

Query shape per tag:

```
[out:json][timeout:25];
nwr["<key>"="<value>"](around:<radiusMeters>,<lat>,<lon>);
out center;
```

`nwr` matches nodes, ways, and relations in one query; `out center;` ensures way/relation
results (which don't carry a single lat/lon of their own) get a computed `center` point.

**User-Agent:** `overpass-api.de`'s Apache config returns a bare 406 for Node's default
`fetch` User-Agent (confirmed live — identical request succeeds via `curl` or with any
distinct User-Agent set). `queryOverpass.ts` sends `cli-util-osmFacilities/1.0`,
which both avoids the 406 and satisfies Overpass's own usage-policy request for an
identifiable client.

**Retry/backoff (`retryDelay.ts`):** the public instance's fair-use rate limiting (429)
and its own load-shedding (503/504) are common under repeated use and are both
transient, so `queryOverpass` retries those up to `MAX_RETRIES` (3) times, honoring the
response's `Retry-After` header when present and otherwise doubling from `BASE_DELAY_MS`
(2s → 4s → 8s). Any other error status (a malformed tag's 400, the earlier 406) is not
retried, since retrying won't change the outcome.

## Files

- `parseTags.ts` — `parseTagList("k1=v1,k2=v2")` → `{key, value}[]`, throwing on any
  entry missing `=`.
- `buildOverpassQuery.ts` — builds the Overpass QL string above for one tag.
- `queryOverpass.ts` — the live fetch call (POSTs the QL query, returns parsed JSON),
  with User-Agent handling and retry/backoff on 429/503/504 — see above.
- `retryDelay.ts` — `computeBackoffDelayMs(attempt)`, the pure exponential-backoff
  calculation used when a response has no `Retry-After` header.
- `parseOverpassResponse.ts` — turns a response's `elements[]` into
  `{tag, name, lat, lon}[]`. A `node`'s own `lat`/`lon` is used directly; a `way`/
  `relation` uses its `center.lat`/`center.lon`. An element missing both is
  warned-and-skipped, not fatal; a response missing the `elements` array entirely throws
  (a structural problem, not a per-item one).
- `haversine.ts` — `haversineDistanceMeters(lat1, lon1, lat2, lon2)`, no external
  dependency.
- `main.ts` — CLI entrypoint: parses args, runs one Overpass request per tag (catching
  and warning on a tag that fails outright rather than aborting the run), merges and
  sorts all matches by distance, writes `output/result.json`.

## Output

Printed to stdout and written to `src/osmFacilities/output/result.json` (gitignored):

```json
{
  "center": { "lon": 121.636, "lat": 25.221 },
  "radiusMeters": 5000,
  "tags": ["shop=department_store", "amenity=cinema", "tourism=hotel"],
  "failedTags": [],
  "matches": [
    { "tag": "tourism=hotel", "name": "Some Hotel", "lat": 25.2215, "lon": 121.6362, "metersToCenter": 63 }
  ]
}
```

`failedTags` lists any requested tag that still failed after exhausting its retries
(e.g. persistent network errors, or Overpass returning a non-retryable status for it) —
its absence from `matches` isn't silent; check this array before treating an empty
result for that tag as "OSM has no coverage here."

## Known limitations

- **OSM coverage varies by area and tag** — an empty `matches` array for a given tag
  means nothing was tagged that way in OSM near this point; it is not proof the facility
  doesn't exist (see the caveat in `references/regionalFactors-fillable.md`).
- **Some Taiwan-specific legal categories don't map cleanly onto OSM tags** — e.g. a
  generic `tourism=hotel` doesn't distinguish a legally-licensed 觀光飯店 from any other
  hotel. For that item specifically, prefer 交通部觀光署's official 旅館民宿 dataset
  instead of this tool (see `references/regionalFactors-fillable.md`).
- **Single point, not parcel-polygon overlap** — like `mapTiles`/`drainageQuality`/
  `windCondition`/`soilQuality`, this CLI takes one representative lon/lat.
- **Shared public instance, fair-use limits apply** — running many tags/points back to
  back in quick succession can still exhaust the retry budget and fail with a 429 after
  ~14s of backoff. Space out repeated runs, or self-host an Overpass instance for heavy
  use.
