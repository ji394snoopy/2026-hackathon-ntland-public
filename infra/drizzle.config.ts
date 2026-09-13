// drizzle-kit config — used ONLY to `generate` SQL DDL from the shared Drizzle schema.
// We deliberately do NOT `drizzle-kit push` against the RDS Data API (see
// db-access-layer-plan.md §2.2): the generated CREATE TABLE / index DDL is run once by
// hand via `aws rds-data execute-statement` (see local-deploy-steps.txt). The Drizzle TS
// schema is the single source of truth; this config just turns it into SQL.
//
// No `dbCredentials` here — generate doesn't connect. Output goes to ./drizzle so it's
// out of the lambda bundle path.

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lambda/shared/db/schema.ts",
  out: "./drizzle",
});
