import { fileURLToPath } from "node:url";
import { PDFFont, PDFPage, rgb } from "pdf-lib";
import { readResultToolInput, runStandaloneFill } from "../shared/fillRunner.js";

const OUTPUT_DIR = "./src/districtSurvey/publicInfrastructure/output";
const RESULT_JSON_PATH = `${OUTPUT_DIR}/result.json`;

const FONT_SIZE = 5.5;
const CIRCLE_SIZE = 6;
const FILLED_MARK = "●";

// Content comes from result.json (generateSample.ts's or a real extraction run's raw response,
// unwrapped below) and draw positions come separately from coordinates-extracted.json
// (generateCoordinate.ts's plain tool-input output — see coordinateTool.ts/coordinatePrompt.ts)
// — two separate Bedrock tool calls, same split trafficAndTransport uses. This file just zips
// the two together at draw time.

const FACILITY_KEYS = [
  "touristRecreationFacility",
  "parkingArea",
  "proximityToServiceFacility",
] as const;

// wastewaterTreatmentFacility's row packs 名稱 and 本區段內/本區段外(距 M) onto a single
// line (nameY === distanceY, unlike the other FACILITY_KEYS rows), so a long 名稱 value
// overlaps the printed 本區段內/外 labels. When 名稱 is set we whiteout that whole line and
// redraw name + labels + circles + distance ourselves, walking an x-cursor by measured
// glyph width so nothing overlaps regardless of name length.
const ROW_SEGMENT_GAP = 4;
const IN_SECTION_LABEL = "○本區段內";
const OUT_SECTION_LABEL = "○本區段外(距";
const DISTANCE_UNIT_LABEL = " M)";

const TEXT_FIELD_KEYS = ["electricPowerResources", "industrialWaterSupply"] as const;

const GROUP_KEYS = ["school", "market", "parkPlazaPedestrianZone"] as const;

function drawRightAligned(
  page: PDFPage,
  text: string,
  endX: number,
  y: number,
  font: PDFFont,
) {
  const width = font.widthOfTextAtSize(text, FONT_SIZE);
  page.drawText(text, {
    x: endX - width,
    y,
    size: FONT_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
}

function fillCircle(page: PDFPage, x: number, y: number, font: PDFFont) {
  page.drawText(FILLED_MARK, {
    x,
    y,
    size: CIRCLE_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
}

function whiteoutAndDraw(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  text: string,
  font: PDFFont,
) {
  page.drawRectangle({
    x,
    y: y - 1.5,
    width,
    height: FONT_SIZE + 1,
    color: rgb(1, 1, 1),
  });
  page.drawText(text, { x, y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
}

function fillFacilityRow(page: PDFPage, item: any, row: any, font: PDFFont) {
  const value = item.value;
  if (value.isExist) {
    page.drawText(value.name, {
      x: row.nameX,
      y: row.nameY,
      size: FONT_SIZE,
      font,
      color: rgb(0, 0, 0),
    });
  }
  // inSection/outSection circles sit on the checkbox+distance line, not the 名稱 line above it.
  if (value.inSection === true) fillCircle(page, row.inSectionX, row.distanceY, font);
  if (value.inSection === false) fillCircle(page, row.outSectionX, row.distanceY, font);
  if (value.distanceValue !== undefined) {
    drawRightAligned(page, String(value.distanceValue), row.distanceEndX, row.distanceY, font);
  }
}

function fillWastewaterTreatmentFacilityRow(page: PDFPage, item: any, row: any, font: PDFFont) {
  const value = item.value;
  if (!value.isExist || !value.name) {
    fillFacilityRow(page, item, row, font);
    return;
  }

  const distanceText = value.distanceValue !== undefined ? String(value.distanceValue) : "";
  const nameWidth = font.widthOfTextAtSize(value.name, FONT_SIZE);
  const inLabelWidth = font.widthOfTextAtSize(IN_SECTION_LABEL, FONT_SIZE);
  const outLabelWidth = font.widthOfTextAtSize(OUT_SECTION_LABEL, FONT_SIZE);
  const distanceWidth = font.widthOfTextAtSize(distanceText, FONT_SIZE);
  const unitWidth = font.widthOfTextAtSize(DISTANCE_UNIT_LABEL, FONT_SIZE);
  const drawnWidth =
    nameWidth +
    ROW_SEGMENT_GAP +
    inLabelWidth +
    ROW_SEGMENT_GAP +
    outLabelWidth +
    distanceWidth +
    unitWidth;
  // The original static labels/circles this replaces run through row.distanceEndX plus a
  // trailing "M)" — whiteout at least that far even if our redrawn content is narrower.
  const staticRegionWidth = row.distanceEndX - row.nameX + unitWidth + ROW_SEGMENT_GAP;
  const whiteoutWidth = Math.max(drawnWidth, staticRegionWidth);

  page.drawRectangle({
    x: row.nameX,
    y: row.nameY - 1.5,
    width: whiteoutWidth,
    height: FONT_SIZE + 1,
    color: rgb(1, 1, 1),
  });

  let x = row.nameX;
  const draw = (text: string) => {
    page.drawText(text, { x, y: row.nameY, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
  };

  draw(value.name);
  x += nameWidth + ROW_SEGMENT_GAP;

  const inSectionCircleX = x;
  draw(IN_SECTION_LABEL);
  x += inLabelWidth + ROW_SEGMENT_GAP;

  const outSectionCircleX = x;
  draw(OUT_SECTION_LABEL);
  x += outLabelWidth;

  if (distanceText) {
    draw(distanceText);
    x += distanceWidth;
  }
  draw(DISTANCE_UNIT_LABEL);

  if (value.inSection === true) fillCircle(page, inSectionCircleX, row.nameY, font);
  if (value.inSection === false) fillCircle(page, outSectionCircleX, row.nameY, font);
}

function fillExistenceCheckRow(page: PDFPage, item: any, row: any, font: PDFFont) {
  const value = item.value;
  if (value.isExist) {
    const width = row.nameGapEndX - row.checkX;
    whiteoutAndDraw(page, row.checkX, row.checkY, width, `${FILLED_MARK}${value.name}`, font);
  }
  if (value.inSection === true) fillCircle(page, row.inSectionX, row.checkY, font);
  if (value.inSection === false) fillCircle(page, row.outSectionX, row.checkY, font);
  if (value.distanceValue !== undefined) {
    drawRightAligned(page, String(value.distanceValue), row.distanceEndX, row.distanceY, font);
  }
}

function fillPublicInfrastructureContent(
  page: PDFPage,
  font: PDFFont,
  coordinates: Record<string, any>,
  content?: Record<string, any>,
) {
  const input = content ?? readResultToolInput(RESULT_JSON_PATH);

  for (const key of FACILITY_KEYS) {
    fillFacilityRow(page, input[key], coordinates[key], font);
  }
  fillWastewaterTreatmentFacilityRow(
    page,
    input.wastewaterTreatmentFacility,
    coordinates.wastewaterTreatmentFacility,
    font,
  );

  // electricPowerResources/industrialWaterSupply are always type=text in practice (their own
  // text field), but the schema also allows number/measurement, so both are handled here too.
  // raw is never read — it exists only for the model's own consistency cross-check.
  for (const key of TEXT_FIELD_KEYS) {
    const value = input[key].value;
    const text: string =
      value.type === "number"
        ? `${value.value}${value.unit ?? ""}`
        : value.type === "measurement"
          ? `${value.label} ${value.value}${value.unit ?? ""}`
          : value.text;
    if (!text) continue;
    const fieldCoords = coordinates[key];
    page.drawText(text, {
      x: fieldCoords.x,
      y: fieldCoords.y,
      size: FONT_SIZE,
      font,
      color: rgb(0, 0, 0),
    });
  }

  for (const key of GROUP_KEYS) {
    const items = input[key].items as any[];
    const rows = coordinates[key] as any[];
    items.forEach((item, i) => {
      if (!rows[i]) {
        console.warn(`publicInfrastructure: missing coordinates for ${key} item ${i}, skipping`);
        return;
      }
      fillExistenceCheckRow(page, item, rows[i], font);
    });
  }

}

export { fillPublicInfrastructureContent };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStandaloneFill({
    outputDir: OUTPUT_DIR,
    fillContent: fillPublicInfrastructureContent,
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
