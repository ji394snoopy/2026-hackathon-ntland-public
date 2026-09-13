// The three factor_standard operations (save / list / get) plus the S3 upload of the
// original PDF. Kept separate from the Function URL plumbing in lambda.ts so the SQL and
// S3 details live in one place.
//
// Storage layout:
//   - factor_standard row (Aurora, gis DB, via Data API repo): file_name / s3_key /
//     extracted (jsonb) / version / label / created_at. Version is per-file_name,
//     incremented by max(version)+1 in a single INSERT ... SELECT (see saveFactorStandard).
//   - original PDF (AssetStack dataBucket): key `<prefix>/<fileName>/v<version>.pdf`,
//     default prefix `factor-standard`.
//
// jsonb over Data API: `extracted` is JSON.stringify'd and bound as a plain string in
// `$n`, then cast with `$n::jsonb` in the SQL. Binding an object directly would fail —
// Data API has no native json binding. See db.ts / facilities/query.ts for the precedent.

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { FactorStandardRepo, Row } from "./db.js";

/** Metadata shape returned by list + as the non-`extracted` part of save/get responses. */
export interface FactorStandardMeta {
  id: number;
  fileName: string;
  version: number;
  label: string | null;
  s3Key: string | null;
  createdAt: string;
}

/** A full record: metadata + the digitized `extracted` payload. */
export interface FactorStandardRecord extends FactorStandardMeta {
  extracted: unknown;
}

/** Columns shared by every SELECT that returns metadata (order-independent, by name). */
const META_COLUMNS =
  "id, file_name, version, label, s3_key, created_at";

// Reshapes a raw DB row (snake_case columns) into the camelCase metadata object the API
// returns. `extracted` is handled separately by callers that need it.
function toMeta(row: Row): FactorStandardMeta {
  return {
    id: Number(row.id),
    fileName: String(row.file_name),
    version: Number(row.version),
    label: row.label == null ? null : String(row.label),
    s3Key: row.s3_key == null ? null : String(row.s3_key),
    createdAt: String(row.created_at),
  };
}

// Parses the `extracted` column, which the Data API repo returns as a JSON string (jsonb
// serialized back to text). If it's already an object (pg's json parsing), pass through.
function parseExtracted(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      // Shouldn't happen for a jsonb column, but don't lose the data if it does.
      return value;
    }
  }
  return value;
}

export interface S3Config {
  client: S3Client;
  bucket: string;
  /** Key prefix under which PDFs are stored. Defaults to "factor-standard". */
  prefix: string;
}

export interface SaveInput {
  fileName: string;
  extracted: unknown;
  label?: string | null;
  /** Base64-encoded original PDF; when given, this lambda uploads it to S3. */
  pdfBase64?: string;
  /** Pre-existing S3 key (caller uploaded the PDF itself). Wins over pdfBase64 upload. */
  s3Key?: string;
}

/**
 * Saves one digitization result:
 *  1. Computes version = max(version for this file_name) + 1 inside the INSERT.
 *  2. If `pdfBase64` is given (and no explicit `s3Key`), uploads the PDF to
 *     `<prefix>/<fileName>/v<version>.pdf` in the dataBucket first, so the row's s3_key
 *     points at a real object.
 *  3. INSERTs the row (extracted bound as $3::jsonb) and returns the new metadata.
 *
 * Version race: max(version)+1 can collide with unique(file_name,version) under high
 * concurrency. For this prototype that's acceptable; a retry on unique violation could be
 * added later. Because the version is computed inside the INSERT, we can't know it before
 * the INSERT — so when uploading a PDF we first read the next version with a cheap SELECT,
 * upload to that key, then INSERT (which recomputes the same max()+1). In the rare race
 * where another writer slips in between, the INSERT still gets a consistent version and
 * the object key may be off by one; acceptable for the prototype.
 */
export async function saveFactorStandard(
  repo: FactorStandardRepo,
  s3: S3Config | null,
  input: SaveInput,
): Promise<FactorStandardMeta> {
  const { fileName, extracted, label = null } = input;

  // Resolve the s3_key to store. Priority: explicit s3Key > uploaded pdfBase64 > null.
  let s3Key: string | null = input.s3Key ?? null;

  if (!s3Key && input.pdfBase64) {
    if (!s3) {
      throw new Error("pdfBase64 given but S3 is not configured (missing ASSET_BUCKET).");
    }
    // Peek the next version so the object key matches the row's version. The INSERT below
    // recomputes max()+1 independently; see the race note in the doc comment.
    const nextVersion = await peekNextVersion(repo, fileName);
    const key = `${s3.prefix}/${fileName}/v${nextVersion}.pdf`;
    const body = Buffer.from(input.pdfBase64, "base64");
    await s3.client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: key,
        Body: body,
        ContentType: "application/pdf",
      }),
    );
    s3Key = key;
  }

  // Single-statement version increment: version = COALESCE(max,0)+1 for this file_name.
  // extracted is bound as a JSON string and cast to jsonb. s3_key may be null.
  const sql = `
    INSERT INTO factor_standard (file_name, s3_key, extracted, version, label)
    SELECT $1, $2, $3::jsonb,
           COALESCE((SELECT max(version) FROM factor_standard WHERE file_name = $1), 0) + 1,
           $4
    RETURNING ${META_COLUMNS}
  `;
  const params = [fileName, s3Key, JSON.stringify(extracted), label];
  const res = await repo.query(sql, params);
  const row = res.rows[0];
  if (!row) throw new Error("INSERT did not return a row.");
  return toMeta(row);
}

// Reads the version that the next INSERT for this file_name will get (max+1). Used only
// to name the uploaded PDF object; the authoritative version comes from the INSERT.
async function peekNextVersion(repo: FactorStandardRepo, fileName: string): Promise<number> {
  const res = await repo.query(
    `SELECT COALESCE(max(version), 0) + 1 AS next FROM factor_standard WHERE file_name = $1`,
    [fileName],
  );
  return Number(res.rows[0]?.next ?? 1);
}

export interface ListFilter {
  fileName?: string;
  label?: string;
}

/**
 * Lists version metadata, optionally filtered by fileName and/or label. Deliberately
 * omits the (potentially large) `extracted` payload so the list stays lightweight.
 * Ordered by file_name, version.
 */
export async function listFactorStandard(
  repo: FactorStandardRepo,
  filter: ListFilter,
): Promise<FactorStandardMeta[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.fileName) {
    params.push(filter.fileName);
    conditions.push(`file_name = $${params.length}`);
  }
  if (filter.label) {
    params.push(filter.label);
    conditions.push(`label = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `
    SELECT ${META_COLUMNS}
    FROM factor_standard
    ${where}
    ORDER BY file_name, version
  `;
  const res = await repo.query(sql, params);
  return res.rows.map(toMeta);
}

export interface GetSelector {
  id?: number;
  fileName?: string;
  /** With fileName: pick this version. Omit to get the latest version for the fileName. */
  version?: number;
}

/**
 * Fetches a single full record (metadata + extracted). Selector is either:
 *  - `id`, or
 *  - `fileName` (+ optional `version`; omit version = latest for that fileName).
 * Returns null if nothing matches.
 */
export async function getFactorStandard(
  repo: FactorStandardRepo,
  selector: GetSelector,
): Promise<FactorStandardRecord | null> {
  let sql: string;
  let params: unknown[];

  if (selector.id != null) {
    sql = `SELECT ${META_COLUMNS}, extracted FROM factor_standard WHERE id = $1`;
    params = [selector.id];
  } else if (selector.fileName != null && selector.version != null) {
    sql = `SELECT ${META_COLUMNS}, extracted FROM factor_standard WHERE file_name = $1 AND version = $2`;
    params = [selector.fileName, selector.version];
  } else if (selector.fileName != null) {
    // Latest version for the file_name.
    sql = `
      SELECT ${META_COLUMNS}, extracted
      FROM factor_standard
      WHERE file_name = $1
      ORDER BY version DESC
      LIMIT 1
    `;
    params = [selector.fileName];
  } else {
    throw new Error("get requires either id or fileName.");
  }

  const res = await repo.query(sql, params);
  const row = res.rows[0];
  if (!row) return null;
  return { ...toMeta(row), extracted: parseExtracted(row.extracted) };
}
