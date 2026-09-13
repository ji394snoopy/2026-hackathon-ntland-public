import { readFileSync } from "node:fs";
import type { RegionalFactorsTree } from "../shared/grading/regionalFactorGrading/resolveGrades.js";
import type { ToolDefinition } from "../shared/tool.js";
import { buildPrompt } from "./prompt.js";
import { buildGradeRegionalFactorsTool } from "./tool.js";

const FACTOR_STANDARD_PATH =
  "./src/regionalFactorGrading/input/factor-standard.json";

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

interface Benchmark {
  location: string;
  area: string;
  width: string;
  depth: string;
  shape: string;
  frontage: string;
  terrain: string;
  roadType: string;
  roadName: string;
  roadWidth: string;
  schoolName: string;
  schoolDistance: string;
  marketName: string;
  marketDistance: string;
  parkName: string;
  parkDistance: string;
  stationName: string;
  stationDistance: string;
  districtName: string;
  districtDistance: string;
  disamenityName: string;
  disamenityDistance: string;
  parking: string;
  zoning: string;
  coverageRatio: string;
  plotRatio: string;
  buildRestriction: string;
  sectionId: string;
}

interface SampleData {
  meta: Meta;
  benchmark: Benchmark;
}

interface Pipeline {
  tool: ToolDefinition;
  promptText: string;
  regionalFactors: RegionalFactorsTree;
  meta: Meta;
  benchmark: Benchmark;
}

function readRegionalFactors(): RegionalFactorsTree {
  const factorStandard = JSON.parse(
    readFileSync(FACTOR_STANDARD_PATH, "utf-8"),
  ) as { regionalFactors: RegionalFactorsTree };
  return factorStandard.regionalFactors;
}

function buildPipeline(sampleDataPath: string): Pipeline {
  const regionalFactors = readRegionalFactors();
  const sampleData = JSON.parse(
    readFileSync(sampleDataPath, "utf-8"),
  ) as SampleData;

  const tool = buildGradeRegionalFactorsTool(regionalFactors);
  const promptText = buildPrompt(sampleData, regionalFactors);

  return {
    tool,
    promptText,
    regionalFactors,
    meta: sampleData.meta,
    benchmark: sampleData.benchmark,
  };
}

export { buildPipeline };
export type { Benchmark, Meta, MetaLocation };
