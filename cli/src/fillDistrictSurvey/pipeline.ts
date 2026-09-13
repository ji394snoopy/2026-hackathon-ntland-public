import { buildCategoryContentTool, buildGroupContentTool, CATEGORY_KEYS, CATEGORY_GROUP_LABELS } from "./tool.js";
import { buildPrompt, buildGroupPrompt } from "./prompt.js";
import type { ToolDefinition } from "../shared/tool.js";
import type { PromptSections } from "../shared/claude.js";
import type { CategoryKey } from "./tool.js";

interface SurveyFact {
  group?: string;
  [key: string]: unknown;
}

interface RawSurveyData {
  survey?: SurveyFact[];
  [key: string]: unknown;
}

interface CategoryPipeline {
  categoryKey: CategoryKey;
  tool: ToolDefinition;
  promptText: PromptSections;
}

function factsForCategory(facts: SurveyFact[], categoryKey: CategoryKey): SurveyFact[] {
  const groupLabel = CATEGORY_GROUP_LABELS[categoryKey];
  return facts.filter((fact) => fact.group === groupLabel);
}

// One tool+prompt per content-tree category, each fed only the raw survey facts whose own
// `group` field matches that category's Chinese group label — see tool.ts for why this is
// split into separate calls instead of one combined schema. Also doubles as the fallback path
// for buildGroupedPipeline below when a merged group hits the grammar-too-large wall.
function buildPipeline(rawSurveyData: RawSurveyData): CategoryPipeline[] {
  const facts = rawSurveyData.survey ?? [];

  return CATEGORY_KEYS.map((categoryKey) => {
    const groupLabel = CATEGORY_GROUP_LABELS[categoryKey];
    const categoryFacts = factsForCategory(facts, categoryKey);
    const tool = buildCategoryContentTool(categoryKey);
    const promptText = buildPrompt(groupLabel, categoryFacts);
    return { categoryKey, tool, promptText };
  });
}

interface GroupPipeline {
  categoryKeys: CategoryKey[];
  tool: ToolDefinition;
  promptText: PromptSections;
}

// Categories not listed in any GROUPS entry are called solo via buildPipeline instead of
// attempted as a merge — see main.ts's extractContent. GROUPS only lists merges confirmed
// against the real Bedrock API (temp/plans/optimize-fill-district-survey-bedrock-calls.md's
// Decision Log): an initial 3-groups-of-2-to-3 hypothesis (grouping by nested-array "weight")
// was tested live and mostly failed — 2 of 3 groups hit Bedrock's "compiled grammar is too
// large" error. What actually distinguishes the one group that *did* succeed
// (landImprovement/specialFacilities/environmentalPollution) is that all three categories have
// very few distinct named schema properties (2, 3, and 1 respectively — mostly repetitive
// "array of facility items" shapes); the categories in the two failed groups each have 6-9
// distinct named properties. This matches this repo's own documented cause elsewhere
// (CLAUDE.md) for this exact Bedrock error: named properties, not array-of-{key,...} entries,
// are what blows up the strict-mode constrained-decoding grammar — merging categories compounds
// it. Only 3 of the 8 categories are this "cheap"; the other 5 stay solo rather than guessing at
// further merges that live testing would likely also fail.
const GROUPS: CategoryKey[][] = [["landImprovement", "specialFacilities", "environmentalPollution"]];

// One tool+prompt per group in GROUPS, each category's facts filtered the same way
// buildPipeline does it (factsForCategory), merged into a single tool call per group.
function buildGroupedPipeline(rawSurveyData: RawSurveyData): GroupPipeline[] {
  const facts = rawSurveyData.survey ?? [];

  return GROUPS.map((categoryKeys) => {
    const tool = buildGroupContentTool(categoryKeys);
    const sections = categoryKeys.map((categoryKey) => ({
      categoryKey,
      groupLabel: CATEGORY_GROUP_LABELS[categoryKey],
      facts: factsForCategory(facts, categoryKey),
    }));
    const promptText = buildGroupPrompt(sections);
    return { categoryKeys, tool, promptText };
  });
}

export { buildPipeline, buildGroupedPipeline, GROUPS };
export type { CategoryPipeline, GroupPipeline };
