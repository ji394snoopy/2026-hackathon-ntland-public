import { readFileSync } from "node:fs";
import type { Benchmark } from "../shared/grading/individualFactorGrading/benchmarkValue.js";
import type { IndividualFactorsTree } from "../shared/grading/individualFactorGrading/resolveGrades.js";
import type { ToolDefinition } from "../shared/tool.js";
import { buildPrompt } from "./prompt.js";
import { buildGradeIndividualFactorsTool } from "./tool.js";

const FACTOR_STANDARD_PATH =
  "./src/individualFactorGrading/input/factor-standard.json";

interface MetaLocation {
  lat: number;
  lng: number;
}

interface Meta {
  yearPeriod: string;
  sectionId: string;
  district: string;
  landUseType: string;
  benchmarkParcel: string;
  surveyDate: string;
  range: string;
  location: MetaLocation;
}

interface SampleData {
  meta: Meta;
  benchmark: Benchmark;
}

interface Pipeline {
  tool: ToolDefinition;
  promptText: string;
  individualFactors: IndividualFactorsTree;
  meta: Meta;
  benchmark: Benchmark;
}

function readIndividualFactors(): IndividualFactorsTree {
  const factorStandard = JSON.parse(
    readFileSync(FACTOR_STANDARD_PATH, "utf-8"),
  ) as { individualFactors: IndividualFactorsTree };
  return factorStandard.individualFactors;
}

function buildPipeline(sampleDataPath: string): Pipeline {
  const individualFactors = readIndividualFactors();
  const sampleData = JSON.parse(
    readFileSync(sampleDataPath, "utf-8"),
  ) as SampleData;

  const tool = buildGradeIndividualFactorsTool(individualFactors);
  const promptText = buildPrompt(sampleData, individualFactors);

  return {
    tool,
    promptText,
    individualFactors,
    meta: sampleData.meta,
    benchmark: sampleData.benchmark,
  };
}

export { buildPipeline };
export type { Benchmark, Meta, MetaLocation };
