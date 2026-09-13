// DB access as a swappable "repo": one small interface, two implementations selected by
// the FACILITIES_DB_DRIVER env var.
//
//   - "pg"       (default) — direct TCP Postgres via node-postgres. Used for local dev
//                            against the Docker PostGIS container (run-local.mjs).
//   - "data-api"           — Aurora PostgreSQL RDS Data API over HTTPS. Used when deployed
//                            by CDK: the Lambda never enters the VPC, and Data API's
//                            managed connection pool avoids the per-execution-environment
//                            connection blow-up that a VPC + pg pool would hit.
//
// Both implementations expose the SAME narrow surface the query layer needs — a single
//   query(sql, params) => { rows }
// with $1/$2 positional placeholders — so query.ts / input.ts / nlsc.ts stay identical
// across local and cloud. Only this connection layer changes.
//
// The two factories live in this one module (rather than separate files) on purpose:
// the handler is esbuild-bundled into a single file with no code-splitting, and both a
// dynamic import() and a cross-module value-import cycle proved fragile there (esbuild
// tree-shook the factories out). Keeping everything here is bundler-robust. The unused
// driver's client is simply never constructed. `pg` is bundled (small); the AWS SDK is
// external (provided by the Node 22 Lambda runtime).

import {
    ExecuteStatementCommand,
    RDSDataClient,
    type ColumnMetadata,
    type Field,
    type SqlParameter,
} from "@aws-sdk/client-rds-data";
import { Pool } from "pg";

/** The one row shape the query layer consumes: each row is a plain column->value map. */
export type Row = Record<string, unknown>;

/** Result of a query, mirroring the subset of `pg`'s QueryResult that query.ts uses. */
export interface QueryResult<T extends Row = Row> {
  rows: T[];
}

/**
 * The minimal DB surface the query layer depends on. Implemented by both the pg repo and
 * the Data API repo. `params` are bound to `$1..$n` positional placeholders in `sql`
 * (Postgres style); the Data API repo rewrites these to its named-parameter form.
 */
export interface FacilitiesRepo {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Releases any held resources (pg pool). No-op for the stateless Data API repo. */
  close(): Promise<void>;
}

export type DbDriver = "pg" | "data-api";

/** Resolves the driver from env; defaults to "pg" so local/run-local keeps working. */
export function resolveDriver(): DbDriver {
  const raw = (process.env.FACILITIES_DB_DRIVER ?? "pg").toLowerCase();
  if (raw === "data-api" || raw === "dataapi" || raw === "rds-data") return "data-api";
  return "pg";
}

// ---------------------------------------------------------------------------
// pg repo (local / direct TCP)
// ---------------------------------------------------------------------------
//
// Connection comes from env vars (12-factor):
//   PGHOST (default 127.0.0.1), PGPORT (default 5432), PGUSER, PGPASSWORD,
//   PGDATABASE, and optional PGSSL=require to force TLS.

function createPgRepo(): FacilitiesRepo {
  const ssl = process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({
    host: process.env.PGHOST ?? "127.0.0.1",
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    user: process.env.PGUSER ?? "postgres",
    password: process.env.PGPASSWORD ?? "postgres",
    database: process.env.PGDATABASE ?? "gis",
    // Keep the pool small — Lambda concurrency scales by spinning up more execution
    // environments, each with its own pool, so a large per-instance pool is wasteful.
    max: process.env.PGPOOL_MAX ? Number(process.env.PGPOOL_MAX) : 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(ssl ? { ssl } : {}),
  });
  return {
    async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const res = await pool.query(sql, params);
      return { rows: res.rows as T[] };
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

// ---------------------------------------------------------------------------
// Data API repo (cloud / Aurora over HTTPS)
// ---------------------------------------------------------------------------
//
// Config via env (set by the CDK LambdaStack):
//   DB_CLUSTER_ARN, DB_SECRET_ARN, DB_NAME  (all required)
//   AWS_REGION is provided by the Lambda runtime.
//
// Two shims bridge Postgres <-> Data API:
//   1. placeholders: Postgres `$1..$n` -> Data API named params `:p1..:pn`.
//   2. results: Data API returns typed `records` (Field[]) + `columnMetadata`; we rebuild
//      plain { column: value } row objects so query.ts sees the same shape pg gives.

// Rewrites Postgres positional placeholders ($1, $2, …) into Data API named placeholders
// (:p1, :p2, …). Higher indices first so `$1` doesn't partially match `$10`.
function rewritePlaceholders(sql: string, paramCount: number): string {
  let out = sql;
  for (let i = paramCount; i >= 1; i--) {
    out = out.replace(new RegExp(`\\$${i}(?!\\d)`, "g"), `:p${i}`);
  }
  return out;
}

// Maps a JS value from query.ts into a Data API SqlParameter. query.ts only ever binds
// strings (GeoJSON text), numbers (lon/lat/radius), booleans, and null — no Buffers/Dates.
function toSqlParameter(name: string, value: unknown): SqlParameter {
  if (value === null || value === undefined) return { name, value: { isNull: true } };
  switch (typeof value) {
    case "string":
      return { name, value: { stringValue: value } };
    case "boolean":
      return { name, value: { booleanValue: value } };
    case "number":
      return Number.isInteger(value)
        ? { name, value: { longValue: value } }
        : { name, value: { doubleValue: value } };
    case "bigint":
      return { name, value: { longValue: Number(value) } };
    default:
      return { name, value: { stringValue: JSON.stringify(value) } };
  }
}

// Extracts the scalar JS value out of a Data API Field.
function fieldToValue(field: Field): unknown {
  if (field.isNull) return null;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.longValue !== undefined) return field.longValue;
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.blobValue !== undefined) return field.blobValue;
  if (field.arrayValue !== undefined) return field.arrayValue;
  return null;
}

// Rebuilds { column: value } row objects from Data API records + columnMetadata.
function toRows<T extends Row>(
  records: Field[][] | undefined,
  columns: ColumnMetadata[] | undefined,
): T[] {
  if (!records || records.length === 0) return [];
  const names = (columns ?? []).map((c, i) => c.label ?? c.name ?? `col${i}`);
  return records.map((record) => {
    const row: Row = {};
    record.forEach((field, i) => {
      row[names[i] ?? `col${i}`] = fieldToValue(field);
    });
    return row as T;
  });
}

function createDataApiRepo(): FacilitiesRepo {
  const clusterArn = process.env.DB_CLUSTER_ARN;
  const secretArn = process.env.DB_SECRET_ARN;
  const database = process.env.DB_NAME ?? "gis";
  if (!clusterArn || !secretArn) {
    throw new Error(
      "Data API driver requires DB_CLUSTER_ARN and DB_SECRET_ARN env vars (set by the CDK LambdaStack).",
    );
  }
  // Region comes from the Lambda runtime (AWS_REGION); the SDK picks it up automatically.
  const client = new RDSDataClient({});
  return {
    async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const parameters = params.map((v, i) => toSqlParameter(`p${i + 1}`, v));
      const res = await client.send(
        new ExecuteStatementCommand({
          resourceArn: clusterArn,
          secretArn,
          database,
          sql: rewritePlaceholders(sql, params.length),
          parameters,
          includeResultMetadata: true,
        }),
      );
      return { rows: toRows<T>(res.records, res.columnMetadata) };
    },
    async close(): Promise<void> {
      client.destroy();
    },
  };
}

// ---------------------------------------------------------------------------
// singleton factory
// ---------------------------------------------------------------------------

let repo: FacilitiesRepo | undefined;

/**
 * Returns the process-wide repo singleton, created on first use and reused across warm
 * Lambda invocations (module scope survives between calls). Driver chosen once from
 * FACILITIES_DB_DRIVER; only the chosen driver's client is constructed.
 */
export async function getRepo(): Promise<FacilitiesRepo> {
  if (repo) return repo;
  repo = resolveDriver() === "data-api" ? createDataApiRepo() : createPgRepo();
  return repo;
}

/**
 * Closes the active repo if one was created. Used by local test harnesses so the process
 * can exit cleanly (the pg pool otherwise holds sockets open). Not needed on Lambda,
 * where the runtime freezes/reuses the execution environment between invocations.
 */
export async function closeRepo(): Promise<void> {
  if (repo) {
    const r = repo;
    repo = undefined;
    await r.close();
  }
}
