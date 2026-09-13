import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, PDFFont, PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const INPUT_PDF_PATH = "./input/district-survey.pdf";
const FONT_PATH = "./assets/ARPLUKaiTW-Book.ttf";

function readResultToolInput(resultJsonPath: string): Record<string, any> {
  const result = JSON.parse(readFileSync(resultJsonPath, "utf-8"));
  const toolUse = result.content.find(
    (block: { type: string }) => block.type === "tool_use",
  );
  return toolUse.input;
}

function readCoordinates(coordinatesJsonPath: string): Record<string, any> {
  return JSON.parse(readFileSync(coordinatesJsonPath, "utf-8"));
}

interface RunStandaloneFillParams {
  outputDir: string;
  fillContent: (
    page: PDFPage,
    font: PDFFont,
    coordinates: Record<string, any>,
  ) => void;
}

async function runStandaloneFill(params: RunStandaloneFillParams): Promise<void> {
  const { outputDir, fillContent } = params;
  const coordinatesJsonPath = `${outputDir}/coordinates-extracted.json`;
  const outputPdfPath = `${outputDir}/district-survey-filled.pdf`;

  const pdfBytes = readFileSync(INPUT_PDF_PATH);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(readFileSync(FONT_PATH), {
    subset: false,
  });
  const page = pdfDoc.getPages()[0]!;
  const coordinates = readCoordinates(coordinatesJsonPath);

  fillContent(page, font, coordinates);

  writeFileSync(outputPdfPath, await pdfDoc.save());
  console.log(`Wrote ${outputPdfPath}`);
}

export { readResultToolInput, runStandaloneFill };
