// 本機小工具：把表四定稿 ComparisonForm（如 e2e-out/comparisonForm.json）用後端 mapper
// comparisonFormToContentTree 轉成 fill-individual-analysis 吃的 content tree，印到 stdout。
//
// 用法（在 infra/ 下）：
//   node --import ./scripts/register-ts.mjs scripts/comparison-form-to-content.mjs <comparisonForm.json> > ../e2e-out/H3_content.json

import { readFileSync } from "node:fs";
import { comparisonFormToContentTree } from "../lambda/shared/db/mappers/grading.ts";

const path = process.argv[2];
if (!path) {
  console.error("用法：... comparison-form-to-content.mjs <comparisonForm.json>");
  process.exit(1);
}

const form = JSON.parse(readFileSync(path, "utf-8"));
if (!form || typeof form !== "object" || !form.benchmark || !Array.isArray(form.cases)) {
  console.error("輸入需為 ComparisonForm（含 benchmark 物件 + cases 陣列）。");
  process.exit(1);
}

const content = comparisonFormToContentTree(form);
process.stdout.write(JSON.stringify(content, null, 2) + "\n");
