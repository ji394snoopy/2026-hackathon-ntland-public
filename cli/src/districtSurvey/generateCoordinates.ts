import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CATEGORY_NAMES } from "./shared/categories.js";
import type { CategoryName } from "./shared/categories.js";
import { generateLandImprovementCoordinates } from "./landImprovement/generateCoordinate.js";
import { generateSpecialFacilitiesCoordinates } from "./specialFacilities/generateCoordinate.js";
import { generateCommercialActivityCoordinates } from "./commercialActivity/generateCoordinate.js";
import { generateLandUseRegulationCoordinates } from "./landUseRegulation/generateCoordinate.js";
import { generateTrafficAndTransportCoordinates } from "./trafficAndTransport/generateCoordinate.js";
import { generatePublicInfrastructureCoordinates } from "./publicInfrastructure/generateCoordinate.js";
import { generateEnvironmentalPollutionCoordinates } from "./environmentalPollution/generateCoordinate.js";
import { generateNaturalConditionsCoordinates } from "./naturalConditions/generateCoordinate.js";

const OUTPUT_DIR = "./src/districtSurvey/output";

type CategoryResults = Record<CategoryName, unknown>;

const GENERATORS: Record<CategoryName, () => Promise<unknown>> = {
  landImprovement: generateLandImprovementCoordinates,
  specialFacilities: generateSpecialFacilitiesCoordinates,
  commercialActivity: generateCommercialActivityCoordinates,
  landUseRegulation: generateLandUseRegulationCoordinates,
  trafficAndTransport: generateTrafficAndTransportCoordinates,
  publicInfrastructure: generatePublicInfrastructureCoordinates,
  environmentalPollution: generateEnvironmentalPollutionCoordinates,
  naturalConditions: generateNaturalConditionsCoordinates,
};

function buildMergedCoordinates(
  results: Partial<CategoryResults>,
): CategoryResults {
  const missing = CATEGORY_NAMES.filter((name) => results[name] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `buildMergedCoordinates: missing coordinates for: ${missing.join(", ")}`,
    );
  }
  return Object.fromEntries(
    CATEGORY_NAMES.map((name) => [name, results[name]]),
  ) as CategoryResults;
}

async function main() {
  console.log("Generating coordinates for all districtSurvey categories...");

  const results: Partial<CategoryResults> = {};
  for (const name of CATEGORY_NAMES) {
    results[name] = await GENERATORS[name]();
  }

  const merged = buildMergedCoordinates(results);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = `${OUTPUT_DIR}/coordinates-merged.json`;
  writeFileSync(outputPath, JSON.stringify(merged, null, 2));

  console.log(`Wrote ${outputPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { buildMergedCoordinates };
