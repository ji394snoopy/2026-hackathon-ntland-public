// Local dev runner for fill-district-survey (表1 地價區段勘查表 PDF). Pure pdf-lib, no
// AWS / DB. POSTs each of input/sample-data-P001-00.json .. sample-data-P004-00.json (the
// four 樹林區 worked examples) -> filled PDF (base64), written to
// infra/lambda/fill-district-survey/export/.
//
// Run:
//   cd infra
//   node --import ./scripts/register-ts.mjs lambda/fill-district-survey/invoke-local.ts
//   open lambda/fill-district-survey/export/fill-district-survey-P001-00.pdf
//
// Endpoint: POST (JSON body = the content tree, or { content: {...} }). Empty body ->
// blank template. The content-tree schema is the one fillEngine.ts fills (see
// input/coordinates.json); each sample-data-P0NN-00.json is a fully-populated worked
// example (the raw { meta, survey, benchmark } 表1 shape, reshaped by normalizeContent.ts).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { postEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

const EXPORT_DIR = resolve(import.meta.dirname, "export");
mkdirSync(EXPORT_DIR, { recursive: true });

const SAMPLE_IDS = ["P001-00", "P002-00", "P003-00", "P004-00"];

for (const id of SAMPLE_IDS) {
  const samplePath = resolve(import.meta.dirname, "input", `sample-data-${id}.json`);
  const content: Record<string, unknown> = JSON.parse(readFileSync(samplePath, "utf-8"));
  const label = `fill-district-survey-${id}`;

  const res = await runLocal(handler, postEvent(content), label);

  // On success, also drop the filled PDF in export/ for inspection/reuse.
  if (res.statusCode === 200) {
    const outFile = resolve(EXPORT_DIR, `${label}.pdf`);
    writeFileSync(outFile, Buffer.from(res.body, "base64"));
    console.log(`[${label}] wrote PDF -> ${outFile}`);
  }
}
