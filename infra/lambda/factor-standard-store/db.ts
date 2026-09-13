// DB access for factor-standard-store, mirroring facilities/db.ts: one small repo
// interface with two implementations selected by FACTOR_STANDARD_DB_DRIVER.
//
//   - "data-api" (default here) — Aurora PostgreSQL RDS Data API over HTTPS. Used when
//                                 deployed by CDK: the Lambda never enters the VPC, and
//                                 Data API's managed pool avoids per-execution-environment
//                                 connection blow-up.
//   - "pg"                      — direct TCP Postgres via node-postgres, for local dev
//                                 against a Docker PostGIS container.
//
// Both expose the SAME narrow surface store.ts needs — a single
//   query(sql, params) => { rows }
// with $1..$n positional placeholders. The Data API repo rewrites those to :p1..:pn.
//
// This is a trimmed copy of facilities/db.ts (see the note there on why both factories
// live in one module: esbuild bundles to a single file with no code-splitting, so a
// dynamic import / cross-module cycle proved fragile — keeping everything here is
// bundler-robust). The unused driver's client is simply never constructed. `pg` is
// bundled (small); the AWS SDK is external (provided by the Node 22 Lambda runtime).
//
// jsonb note: Data API has no native json binding. store.ts binds the `extracted` object
// as a JSON string in `$n` and casts with `$n::jsonb` in the SQL; on read it takes the
// whole column back as a string and JSON.parses it. See facilities/query.ts for the
// same string-bind + ::type cast precedent (it does it with GeoJSON).

import {
  ExecuteStatementCommand,
  RDSDataClient,
  type ColumnMetadata,
  type Field,
  type SqlParameter,
} from "@aws-sdk/client-rds-data";
import { Pool } from "pg";

/** The one row shape store.ts consumes: each row is a plain column->value map. */
export type Row = Record<string, unknown>;

/** Result of a query, mirroring the subset of `pg`'s QueryResult that store.ts uses. */
export interface QueryResult<T extends Row = Row> {
  rows: T[];
}

/**
 * The minimal DB surface store.ts depends on. Implemented by both the pg repo and the
 * Data API repo. `params` bind to `$1..$n` positional placeholders in `sql` (Postgres
 * style); the Data API repo rewrites these to its named-parameter form.
 */
export interface FactorStandardRepo {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Releases any held resources (pg pool). No-op for the stateless Data API repo. */
  close(): Promise<void>;
}

export type DbDriver = "pg" | "data-api";

/**
 * Resolves the driver from env. Defaults to "data-api" — this lambda's primary target is
 * the deployed Aurora cluster. Set FACTOR_STANDARD_DB_DRIVER=pg for local dev.
 */
export function resolveDriver(): DbDriver {
  const raw = (process.env.FACTOR_STANDARD_DB_DRIVER ?? "data-api").toLowerCase();
  if (raw === "pg") return "pg";
  return "data-api";
}

// ---------------------------------------------------------------------------
// pg repo (local / direct TCP)
// ---------------------------------------------------------------------------

function createPgRepo(): FactorStandardRepo {
  const ssl = process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({
    host: process.env.PGHOST ?? "127.0.0.1",
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    user: process.env.PGUSER ?? "postgres",
    password: process.env.PGPASSWORD ?? "postgres",
    database: process.env.PGDATABASE ?? "gis",
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
// Config via env (set by the CDK BedrockStack):
//   DB_CLUSTER_ARN, DB_SECRET_ARN, DB_NAME  (cluster/secret required)
//   AWS_REGION is provided by the Lambda runtime.

// Rewrites Postgres positional placeholders ($1, $2, …) into Data API named placeholders
// (:p1, :p2, …). Higher indices first so `$1` doesn't partially match `$10`.
function rewritePlaceholders(sql: string, paramCount: number): string {
  let out = sql;
  for (let i = paramCount; i >= 1; i--) {
    out = out.replace(new RegExp(`\\$${i}(?!\\d)`, "g"), `:p${i}`);
  }
  return out;
}

// Maps a JS value into a Data API SqlParameter. store.ts binds strings (fileName, s3Key,
// label, and the JSON-stringified `extracted`), numbers (version), and null — no
// Buffers/Dates. Objects fall through to a JSON string (defensive; store.ts stringifies
// `extracted` itself before binding so it lands in the string branch).
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

function createDataApiRepo(): FactorStandardRepo {
  const clusterArn = process.env.DB_CLUSTER_ARN;
  const secretArn = process.env.DB_SECRET_ARN;
  const database = process.env.DB_NAME ?? "gis";
  if (!clusterArn || !secretArn) {
    throw new Error(
      "Data API driver requires DB_CLUSTER_ARN and DB_SECRET_ARN env vars (set by the CDK BedrockStack).",
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

let repo: FactorStandardRepo | undefined;

/**
 * Returns the process-wide repo singleton, created on first use and reused across warm
 * Lambda invocations. Driver chosen once from FACTOR_STANDARD_DB_DRIVER; only the chosen
 * driver's client is constructed.
 */
export function getRepo(): FactorStandardRepo {
  if (repo) return repo;
  repo = resolveDriver() === "pg" ? createPgRepo() : createDataApiRepo();
  return repo;
}

/** Closes the active repo if one was created. Used by local test harnesses. */
export async function closeRepo(): Promise<void> {
  if (repo) {
    const r = repo;
    repo = undefined;
    await r.close();
  }
}
