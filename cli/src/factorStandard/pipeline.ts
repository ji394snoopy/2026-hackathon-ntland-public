import { readFileSync } from "node:fs";
import { buildExtractResultTool } from "./tool.js";
import { buildPrompt } from "./prompt.js";
import type { CategoryMapping, ToolDefinition } from "../shared/tool.js";

interface Pipeline {
  tool: ToolDefinition;
  promptText: string;
}

function readMapping(filename: string): Record<string, string> {
  return JSON.parse(readFileSync(`./references/${filename}`, "utf-8"));
}

function buildPipeline(): Pipeline {
  const gradeMapping = readMapping("zh_en_grade_mapping.json");
  const categoryMapping = JSON.parse(
    readFileSync("./references/zh_en_category_mapping.json", "utf-8"),
  ) as CategoryMapping;
  const itemMapping = readMapping("zh_en_item_mapping.json");
  const enumValueMapping = readMapping("zh_en_enum_value_mapping.json");

  const tool = buildExtractResultTool(gradeMapping, categoryMapping, itemMapping);
  const fullVocabulary = {
    ...gradeMapping,
    ...categoryMapping.regional,
    ...categoryMapping.individual,
    ...itemMapping,
    ...enumValueMapping,
  };

  return { tool, promptText: buildPrompt(fullVocabulary) };
}

export { buildPipeline };
