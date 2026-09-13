// 本機小工具：把表二定稿 RegionalFactorRow[]（如 e2e-out/regionalFactors.json）用後端反向
// mapper regionalRowsToAnalysisContent 轉成 fill-regional-analysis 吃的 content tree，
// 包上 { purpose, content } 印到 stdout。
//
// 用法（在 infra/ 下）：
//   node --import ./scripts/register-ts.mjs scripts/regional-rows-to-content.mjs <rows.json> <sectionIdBase> [purpose]
// 範例：
//   node --import ./scripts/register-ts.mjs scripts/regional-rows-to-content.mjs ../e2e-out/regionalFactors.json P002-00 commercial > ../e2e-out/H2_content.json
//
// purpose ∈ agricultural|commercial|industrial|other|residential（預設 commercial）。

import { readFileSync } from "node:fs";
import { regionalRowsToAnalysisContent } from "../lambda/shared/db/mappers/grading.ts";

const path = process.argv[2];
const sectionIdBase = process.argv[3] ?? "";
const purpose = process.argv[4] ?? "commercial";
if (!path) {
  console.error("用法：... regional-rows-to-content.mjs <rows.json> <sectionIdBase> [purpose]");
  process.exit(1);
}

const rows = JSON.parse(readFileSync(path, "utf-8"));
if (!Array.isArray(rows)) {
  console.error("輸入需為 RegionalFactorRow[]（陣列）。");
  process.exit(1);
}

const content = regionalRowsToAnalysisContent(rows, sectionIdBase);
process.stdout.write(JSON.stringify({ purpose, content }, null, 2) + "\n");
