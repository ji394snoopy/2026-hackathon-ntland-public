// Shared Drizzle client over the RDS Data API. Any lambda that needs the DB does:
//
//   import { getDb, schema } from "../shared/db";
//   const db = getDb();
//   await db.select().from(schema.appraisalCase).where(...);
//
// and gets a type-safe Drizzle handle — no hand-written SQL strings, no manual $1->:p1
// placeholder rewriting, no jsonb ::cast dance (the Data API driver handles all of it).
//
// Env contract (fixed, plan §Task 0): always Data API, always these three vars. We do NOT
// use a per-lambda driver switch like facilities' FACILITIES_DB_DRIVER / factor-standard's
// FACTOR_STANDARD_DB_DRIVER — the shared layer is Data-API-only. (Local pg-direct testing,
// if ever needed, is a separate concern and out of scope here.)
//
//   DB_CLUSTER_ARN, DB_SECRET_ARN  (required)
//   DB_NAME                        (defaults to "gis")
//   AWS_REGION                     (provided by the Lambda runtime; SDK picks it up)

import { drizzle } from "drizzle-orm/aws-data-api/pg";
import { schema } from "./schema";

export type Db = ReturnType<typeof createDb>;

function createDb() {
  const resourceArn = process.env.DB_CLUSTER_ARN;
  const secretArn = process.env.DB_SECRET_ARN;
  const database = process.env.DB_NAME ?? "gis";
  if (!resourceArn || !secretArn) {
    throw new Error(
      "Shared DB layer requires DB_CLUSTER_ARN and DB_SECRET_ARN env vars (set by the CDK stack).",
    );
  }
  // Region comes from the Lambda runtime via AWS_REGION; the RDS Data API client picks it
  // up from the default provider chain, so no explicit region needed here.
  return drizzle({
    connection: { database, resourceArn, secretArn },
    schema,
  });
}

// Module-scope singleton: created on first use and reused across warm Lambda invocations
// (module scope survives between calls on a frozen/thawed execution environment). Mirrors
// the warm-reuse intent of facilities/db.ts's getRepo().
let db: Db | undefined;

/** Returns the process-wide Drizzle handle, creating it on first use. */
export function getDb(): Db {
  if (!db) db = createDb();
  return db;
}
