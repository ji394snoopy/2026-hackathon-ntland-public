// 本機小工具：把估價師定稿的表一 SurveyField[]（如 e2e-out/Bp_survey_edited.json）
// 用後端 mapper surveyToContentTree 轉成 fill-district-survey 吃的 content tree，印到 stdout。
//
// 用途：在後端 mapper 還沒進 orchestration / 未 deploy 前，先在本機把定稿轉好，
// 存成檔案再 curl 餵 fill-district-survey（H1）驗證表一 PDF 能正確填值。
//
// 用法（在 infra/ 下）：
//   node --import ./scripts/register-ts.mjs scripts/survey-to-content-tree.mjs <survey.json 路徑>
// 範例：
//   node --import ./scripts/register-ts.mjs scripts/survey-to-content-tree.mjs ../e2e-out/Bp_survey_edited.json > ../e2e-out/H1_content_tree.json
//
// 輸入可為：① 完整 { meta, survey, benchmark }（Bp_survey_edited.json 就是這種），或 ② 直接是 SurveyField[]。

import { readFileSync } from "node:fs";
import { surveyToContentTree } from "../lambda/shared/db/mappers/survey.ts";

const path = process.argv[2];
if (!path) {
  console.error("用法：node --import ./scripts/register-ts.mjs scripts/survey-to-content-tree.mjs <survey.json>");
  process.exit(1);
}

const parsed = JSON.parse(readFileSync(path, "utf-8"));
const survey = Array.isArray(parsed) ? parsed : parsed.survey;
const meta = Array.isArray(parsed) ? undefined : parsed.meta;
const benchmark = Array.isArray(parsed) ? undefined : parsed.benchmark;

if (!Array.isArray(survey)) {
  console.error("找不到 survey 陣列。輸入需為 SurveyField[] 或 { survey: SurveyField[] }。");
  process.exit(1);
}

const tree = surveyToContentTree(survey, meta, benchmark);
process.stdout.write(JSON.stringify(tree, null, 2) + "\n");
