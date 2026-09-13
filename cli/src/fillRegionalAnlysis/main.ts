import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { planDraws, renderDraws, FONT_SIZE } from "./fillEngine.js";
import { PURPOSES } from "./generateCoordinates.js";
import type { Purpose } from "./generateCoordinates.js";

const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const INPUT_DIR = `${MODULE_DIR}input`;
const OUTPUT_DIR = `${MODULE_DIR}output`;
const FONT_PATH = "./assets/ARPLUKaiTW-Book.ttf";

function isPurpose(value: string): value is Purpose {
  return (PURPOSES as readonly string[]).includes(value);
}

async function main(purposeArg: string | undefined): Promise<void> {
  if (!purposeArg || !isPurpose(purposeArg)) {
    throw new Error(
      `fillRegionalAnlysis: expected a purpose argument, one of ${PURPOSES.join(", ")} (got ${purposeArg ?? "none"})`,
    );
  }
  const purpose = purposeArg;

  const pdfPath = `${INPUT_DIR}/regional-anlysis-${purpose}.pdf`;
  const coordinatesPath = `${INPUT_DIR}/coordinates-${purpose}.json`;
  const contentPath = `${INPUT_DIR}/comparison-${purpose}.json`;
  const outputPath = `${OUTPUT_DIR}/regional-analysis-${purpose}-filled.pdf`;

  const pdfDoc = await PDFDocument.load(readFileSync(pdfPath));
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(readFileSync(FONT_PATH), { subset: false });
  const page = pdfDoc.getPages()[0]!;

  const coordinates = JSON.parse(readFileSync(coordinatesPath, "utf-8"));
  const content = JSON.parse(readFileSync(contentPath, "utf-8"));
  const measureText = (text: string) => font.widthOfTextAtSize(text, FONT_SIZE);

  const instructions = planDraws(content, coordinates, measureText);
  renderDraws(page, font, instructions);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(outputPath, await pdfDoc.save());
  console.log(`Wrote ${outputPath}`);
}

export { main };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
