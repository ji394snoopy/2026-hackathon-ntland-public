-- 交流道 merge: 高公局 CSV (props.source='freeway-bureau') + the OSM leftovers.
--
-- Runs AFTER 20-pois.sql has built the `pois` table with BOTH interchange sources staged
-- into it as category='motorway_junction'. Kept in its own file (rather than appended to
-- 20-pois.sql) because the cloud seeder replays the exact same statements over the RDS
-- Data API — see infra/scripts/seed-cloud.mjs seedPois(). One source of truth for the
-- merge rules means the local Docker DB and cloud Aurora can't drift apart.
--
-- NOTE for the cloud path: seed-cloud.mjs splits this file on `;` after stripping `--`
-- comments, so每 statement must end with a semicolon and no statement body may contain a
-- semicolon inside a string literal.
--
-- ---------------------------------------------------------------------------
-- Why two sources
-- ---------------------------------------------------------------------------
-- They are largely COMPLEMENTARY, not duplicates — only 20 of OSM's 64 distinct names
-- appear in the official list, and 40 of its 118 points sit >3km from any official
-- interchange:
--
--   * 高公局 CSV — the 國道 interchanges, nationwide, one row per interchange, with 里程 K.
--     Authoritative, already de-duplicated. Has NO 快速道路 (台64/台65/台62).
--   * OSM      — ramp *nodes*, so one interchange becomes several points (三重交流道: 5
--     points over 824m; 林口交流道: 3 over 2.7km), plus 21 expressway exit ramps
--     (「中興橋出口」), 6 unnamed nodes, 「石碇服務區」 and a mis-tagged 「高速公路局」.
--     But it is the ONLY source for the 快速道路 interchanges (八里一/二/三, 板橋一/二,
--     中和一/二, 土城一/二, 新莊一/二, 五股一/二, 江子翠, 觀音山, 泰山, 四腳亭, 坪林…).
--
-- So: normalise the CSV, then from OSM keep only what the CSV cannot supply.

-- Step 1 — the CSV lists a 系統交流道 once per 國道 it serves: 南港系統交流道 appears on
-- both 國道3號 and 國道5號, 機場系統交流道 on three routes, and the 轉接道 rows are
-- duplicated at identical coordinates. One physical interchange therefore arrives as 2-3
-- rows, up to ~1km apart, which would show up two or three times in a facilities result.
-- Collapse each name to one row at the centroid of its points. `road` becomes the merged
-- route list and `km` the per-route detail, so nothing the CSV carried is lost — `km` is
-- already text (國道1號(高架) uses values like "高架13"), so a compound string fits.
WITH grouped AS (
  SELECT name,
         min(id)                       AS keep_id,
         ST_Centroid(ST_Collect(geom)) AS center,
         count(*)                      AS n,
         string_agg(DISTINCT props->>'road', ' + ' ORDER BY props->>'road') AS roads,
         string_agg(
           (props->>'road') || ' K' || COALESCE(props->>'km', '?'), ' / '
           ORDER BY props->>'road'
         ) AS km_detail
  FROM pois
  WHERE category = 'motorway_junction'
    AND props->>'source' = 'freeway-bureau'
    AND name IS NOT NULL
  GROUP BY name
  HAVING count(*) > 1
)
UPDATE pois p
SET geom  = g.center,
    props = p.props || jsonb_build_object('road', g.roads, 'km', g.km_detail,
                                          'merged_rows', g.n)
FROM grouped g
WHERE p.id = g.keep_id;

DELETE FROM pois p
USING (
  SELECT name, min(id) AS keep_id
  FROM pois
  WHERE category = 'motorway_junction'
    AND props->>'source' = 'freeway-bureau'
    AND name IS NOT NULL
  GROUP BY name
) g
WHERE p.category = 'motorway_junction'
  AND p.props->>'source' = 'freeway-bureau'
  AND p.name = g.name
  AND p.id <> g.keep_id;

-- Step 2 — drop the OSM rows that aren't interchange bodies at all. Exit ramps, unnamed
-- nodes, the 服務區 and the mis-tagged office all fail the name shape test.
DELETE FROM pois p
WHERE p.category = 'motorway_junction'
  AND p.props->>'source' IS DISTINCT FROM 'freeway-bureau'
  AND (
    p.name IS NULL
    OR NOT (p.name LIKE '%交流道' OR p.name LIKE '%端' OR p.name LIKE '%轉接道')
  );

-- Step 3 — drop the OSM rows the official data already covers, by name (the 18 true
-- overlaps: 汐止交流道, 三重交流道, 安坑交流道, …).
DELETE FROM pois p
WHERE p.category = 'motorway_junction'
  AND p.props->>'source' IS DISTINCT FROM 'freeway-bureau'
  AND EXISTS (
    SELECT 1 FROM pois c
    WHERE c.category = 'motorway_junction'
      AND c.props->>'source' = 'freeway-bureau'
      AND c.name = p.name
  );

-- Step 4 — spatial backstop for the same feature named differently on each side (e.g. an
-- OSM ramp node sitting on top of an official interchange under another label). 300m is
-- comfortably below the gap between genuinely distinct neighbouring interchanges here.
DELETE FROM pois p
WHERE p.category = 'motorway_junction'
  AND p.props->>'source' IS DISTINCT FROM 'freeway-bureau'
  AND EXISTS (
    SELECT 1 FROM pois c
    WHERE c.category = 'motorway_junction'
      AND c.props->>'source' = 'freeway-bureau'
      AND ST_DWithin(c.geom::geography, p.geom::geography, 300)
  );

-- Step 5 — the surviving OSM 快速道路 interchanges are still ramp nodes, so a single
-- interchange can hold several same-named rows (八里二交流道: 4 points over 216m). Collapse
-- each name to one row placed at the centroid of its points: keep the lowest id, move it
-- to the centroid, delete the rest. Distances are then measured to the interchange as a
-- whole rather than to whichever ramp OSM happened to map first.
WITH grouped AS (
  SELECT name,
         min(id)                       AS keep_id,
         ST_Centroid(ST_Collect(geom)) AS center,
         count(*)                      AS n
  FROM pois
  WHERE category = 'motorway_junction'
    AND props->>'source' IS DISTINCT FROM 'freeway-bureau'
  GROUP BY name
  HAVING count(*) > 1
)
UPDATE pois p
SET geom = g.center
FROM grouped g
WHERE p.id = g.keep_id;

DELETE FROM pois p
USING (
  SELECT name, min(id) AS keep_id
  FROM pois
  WHERE category = 'motorway_junction'
    AND props->>'source' IS DISTINCT FROM 'freeway-bureau'
  GROUP BY name
) g
WHERE p.category = 'motorway_junction'
  AND p.props->>'source' IS DISTINCT FROM 'freeway-bureau'
  AND p.name = g.name
  AND p.id <> g.keep_id;

-- Step 6 — LAST, deliberately: one physical point can carry two DIFFERENT official names,
-- one per route segment — 台北交流道 (國道1號平面) and 環北交流道 (國道1號高架) share a single
-- coordinate, as do 汐止端/高架道路汐止端, 楊梅端/高架道路楊梅端 and 潭子/潭子系統. Step 1
-- keys on the name so these survive it. Collapse points coinciding to ~1m, joining the
-- names with " / " so neither label is lost.
--
-- This MUST run after steps 3-5: it rewrites `name` into a joined string, and step 3
-- deletes OSM rows by exact name equality against the official side. Run earlier, an OSM
-- 「環北交流道」 would no longer match the now-renamed official row and would survive as a
-- second, redundant interchange ~1.2km away.
WITH coincident AS (
  SELECT round(ST_X(geom)::numeric, 5) AS gx,
         round(ST_Y(geom)::numeric, 5) AS gy,
         min(id)  AS keep_id,
         count(*) AS n,
         string_agg(DISTINCT name, ' / ' ORDER BY name)                     AS names,
         string_agg(DISTINCT props->>'road', ' + ' ORDER BY props->>'road') AS roads,
         string_agg((props->>'road') || ' K' || COALESCE(props->>'km', '?'), ' / '
                    ORDER BY props->>'road')                                AS km_detail
  FROM pois
  WHERE category = 'motorway_junction'
    AND props->>'source' = 'freeway-bureau'
    AND name IS NOT NULL
  GROUP BY 1, 2
  HAVING count(*) > 1
)
UPDATE pois p
SET name  = c.names,
    props = p.props || jsonb_build_object('name', c.names, 'road', c.roads,
                                          'km', c.km_detail, 'merged_rows', c.n)
FROM coincident c
WHERE p.id = c.keep_id;

DELETE FROM pois p
USING (
  SELECT round(ST_X(geom)::numeric, 5) AS gx, round(ST_Y(geom)::numeric, 5) AS gy,
         min(id) AS keep_id
  FROM pois
  WHERE category = 'motorway_junction'
    AND props->>'source' = 'freeway-bureau'
    AND name IS NOT NULL
  GROUP BY 1, 2
) c
WHERE p.category = 'motorway_junction'
  AND p.props->>'source' = 'freeway-bureau'
  AND round(ST_X(p.geom)::numeric, 5) = c.gx
  AND round(ST_Y(p.geom)::numeric, 5) = c.gy
  AND p.id <> c.keep_id;

ANALYZE pois;
