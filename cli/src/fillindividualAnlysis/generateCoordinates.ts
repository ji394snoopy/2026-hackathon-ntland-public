import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractCoordinates } from "./extractCoordinates.js";
import type { RawTextItem } from "./extractCoordinates.js";

const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const INPUT_DIR = `${MODULE_DIR}input`;
const OUTPUT_DIR = `${MODULE_DIR}output`;
const PDF_PATH = `${INPUT_DIR}/individual-asnlysis.pdf`;
const COORDINATES_PATH = `${INPUT_DIR}/coordinates.json`;

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

async function main(): Promise<void> {
  const textItems = await extractTextItems(PDF_PATH);
  const coordinates = extractCoordinates(textItems);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(`${OUTPUT_DIR}/coordinates-textItems.json`, JSON.stringify(textItems, null, 2));

  writeFileSync(COORDINATES_PATH, JSON.stringify(coordinates, null, 2));
  console.log(`Wrote ${COORDINATES_PATH}`);
}

export { main };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
