import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync } from "node:fs";
import { extractCoordinates } from "./extractCoordinates.js";
import type { RawTextItem } from "./extractCoordinates.js";

const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const INPUT_DIR = `${MODULE_DIR}input`;
const OUTPUT_DIR = `${MODULE_DIR}output`;

const PURPOSES = ["agricultural", "commercial", "industrial", "other", "residential"] as const;
type Purpose = (typeof PURPOSES)[number];

function isPurpose(value: string): value is Purpose {
  return (PURPOSES as readonly string[]).includes(value);
}

async function extractTextItems(pdfPath: string): Promise<RawTextItem[]> {
  const data = new Uint8Array(readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  return (content.items as { str: string; transform: number[] }[]).map((it) => ({
    str: it.str,
    x: it.transform[4]!,
    y: it.transform[5]!,
  }));
}

async function generateCoordinatesFor(purpose: Purpose): Promise<unknown> {
  const pdfPath = `${INPUT_DIR}/regional-anlysis-${purpose}.pdf`;
  const textItems = await extractTextItems(pdfPath);
  const coordinates = extractCoordinates(textItems);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(`${OUTPUT_DIR}/coordinates-${purpose}-textItems.json`, JSON.stringify(textItems, null, 2));

  const committedPath = `${INPUT_DIR}/coordinates-${purpose}.json`;
  writeFileSync(committedPath, JSON.stringify(coordinates, null, 2));
  console.log(`Wrote ${committedPath}`);
  return coordinates;
}

async function main(purposeArg?: string): Promise<void> {
  const targets = purposeArg ? [purposeArg] : [...PURPOSES];
  for (const target of targets) {
    if (!isPurpose(target)) {
      throw new Error(`generateCoordinates: unknown purpose "${target}", expected one of ${PURPOSES.join(", ")}`);
    }
    await generateCoordinatesFor(target);
  }
}

export { main, generateCoordinatesFor, PURPOSES };
export type { Purpose };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
