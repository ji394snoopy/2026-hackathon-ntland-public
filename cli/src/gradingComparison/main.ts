import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildFillReport, deriveLabel } from "./compareGraded.js";
import type { GradedResultWithMeta } from "./compareGraded.js";

const OUTPUT_DIR = "./src/gradingComparison/output";

function readGraded(path: string): GradedResultWithMeta {
  return JSON.parse(readFileSync(path, "utf-8")) as GradedResultWithMeta;
}

function main() {
  const [, , pathA, ...pathBs] = process.argv;

  if (!pathA || pathBs.length === 0) {
    console.error("usage: main.ts <pathA> <pathB...>");
    process.exit(1);
  }

  const a = readGraded(pathA);
  const bEntries = pathBs.map((pathB) => ({
    label: deriveLabel(pathB),
    graded: readGraded(pathB),
  }));

  const report = buildFillReport(a, bEntries);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = `${OUTPUT_DIR}/comparison.json`;
  writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${outputPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
