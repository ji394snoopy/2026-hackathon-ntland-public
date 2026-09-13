-- Enable PostGIS in the `gis` database. The postgis/postgis image ships the extension
-- files at the OS level, but they still need to be enabled per-database.
--
-- This runs automatically the first time the container initialises a fresh data volume
-- (via /docker-entrypoint-initdb.d). To enable PostGIS manually on an existing DB
-- instead, connect and run these same statements:
--   psql postgresql://postgres:postgres@localhost:5432/gis
--   CREATE EXTENSION IF NOT EXISTS postgis;

CREATE EXTENSION IF NOT EXISTS postgis;
-- Topology is optional; include it since several opendata workflows use it. Drop this
-- line if you don't need it.
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Sanity check written to the container logs on first init.
SELECT postgis_full_version();
