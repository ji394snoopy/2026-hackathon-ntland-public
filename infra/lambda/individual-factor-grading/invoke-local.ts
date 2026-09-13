// Local dev runner for individual-factor-grading (表4 個別因素評分, Bedrock 純文字).
// NEEDS AWS creds + Bedrock access to jp.anthropic.claude-sonnet-4-6.
//
// The handler takes { meta, benchmark } (survey optional) — same shape as the CLI's
// sample-data.json. Grading is benchmark-driven. Those samples are input data, not a handler
// asset, so this runner reads them off disk — defaulting to the 4 district survey samples
// co-located with this lambda (input/sample-data-P001-00.json through
// input/sample-data-P004-00.json), invoking the handler once per section in sequence.
// Override with SAMPLE=<path> to grade a single file instead.
//
// Run:
//   cd infra
//   AWS_PROFILE=PROFILE AWS_REGION=us-east-1 \
//     node --import ./scripts/register-ts.mjs lambda/individual-factor-grading/invoke-local.ts
//
// 回:{ meta, benchmark, individualFactors: {...}, totalScore }(同 CLI graded.json)，each section
// printed and, on success, written to export/individual-factor-grading-<sectionId>-<ts>.json.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { postEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

const INPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "input");
const EXPORT_DIR = resolve(import.meta.dirname, "export");

// Default to the 4 district survey samples (區段編號 P001-00 .. P004-00). Set SAMPLE to grade
// just one file instead.
const SECTION_IDS = ["P001-00", "P002-00", "P003-00", "P004-00"];
const samplePaths = process.env.SAMPLE
  ? [process.env.SAMPLE]
  : SECTION_IDS.map((id) => join(INPUT_DIR, `sample-data-${id}.json`));

const batchTs = Date.now();

for (const samplePath of samplePaths) {
  const sample = JSON.parse(readFileSync(samplePath, "utf-8")) as { meta?: { sectionId?: string } };
  const sectionId = sample.meta?.sectionId ?? "unknown-section";
  console.log(`\n[individual-factor-grading] using sample: ${samplePath} (sectionId=${sectionId})`);

  const res = await runLocal(handler, postEvent(sample), `individual-factor-grading-${sectionId}`);

  // On success, also drop the graded result in export/ for inspection/reuse.
  if (res.statusCode === 200) {
    mkdirSync(EXPORT_DIR, { recursive: true });
    const outFile = resolve(EXPORT_DIR, `individual-factor-grading-${sectionId}-${batchTs}.json`);
    writeFileSync(outFile, JSON.stringify(JSON.parse(res.body), null, 2));
    console.log(`[individual-factor-grading] wrote result -> ${outFile}`);
  } else {
    console.error(`[individual-factor-grading] ${sectionId} failed with status ${res.statusCode}, skipping export`);
  }
}
