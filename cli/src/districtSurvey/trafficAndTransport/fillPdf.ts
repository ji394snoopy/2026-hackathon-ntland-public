import { fileURLToPath } from "node:url";
import { PDFFont, PDFPage, rgb } from "pdf-lib";
import { readResultToolInput, runStandaloneFill } from "../shared/fillRunner.js";

const OUTPUT_DIR = "./src/districtSurvey/trafficAndTransport/output";
const RESULT_JSON_PATH = `${OUTPUT_DIR}/result.json`;

const FONT_SIZE = 5.5;
const CIRCLE_SIZE = 6;
const FILLED_MARK = "●";

// Content comes from result.json (generateSample.ts's or a real extraction run's raw response,
// unwrapped below) and draw positions come separately from coordinates-extracted.json
// (generateCoordinate.ts's plain tool-input output — see coordinateTool.ts/coordinatePrompt.ts)
// — two separate Bedrock tool calls, since a single combined schema hit Bedrock's
// compiled-grammar size limit. This file just zips the two together at draw time.

const TEXT_FIELD_KEYS = [
  "proximityToSettlement",
  "proximityToDistributionCenter",
  "proximityToMarket",
  "roadConstructionLevel",
] as const;

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

function fillStationRow(
  page: PDFPage,
  item: any,
  row: any,
  font: PDFFont,
) {
  const value = item.value;
  if (value.isExist) {
    const width = row.nameGapEndX - row.circleX;
    whiteoutAndDraw(
      page,
      row.circleX,
      row.circleY,
      width,
      `${FILLED_MARK}${value.name}`,
      font,
    );
  }
  if (value.inSection === true)
    fillCircle(page, row.inSectionX, row.circleY, font);
  if (value.inSection === false)
    fillCircle(page, row.outSectionX, row.circleY, font);
  if (value.distanceValue !== undefined) {
    drawRightAligned(
      page,
      String(value.distanceValue),
      row.distanceEndX,
      row.distanceY,
      font,
    );
  }
}

function fillTrafficAndTransportContent(
  page: PDFPage,
  font: PDFFont,
  coordinates: Record<string, any>,
  content?: Record<string, any>,
) {
  const input = content ?? readResultToolInput(RESULT_JSON_PATH);

  const mainRoad = input.mainRoad.value;
  const mainRoadCoords = coordinates.mainRoad;
  page.drawText(mainRoad.label, {
    x: mainRoadCoords.labelX,
    y: mainRoadCoords.labelY,
    size: FONT_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
  drawRightAligned(
    page,
    String(mainRoad.value),
    mainRoadCoords.valueEndX,
    mainRoadCoords.valueY,
    font,
  );

  const averageRoadWidth = input.averageRoadWidthInSection.value;
  const averageRoadWidthCoords = coordinates.averageRoadWidthInSection;
  drawRightAligned(
    page,
    String(averageRoadWidth.value),
    averageRoadWidthCoords.valueEndX,
    averageRoadWidthCoords.valueY,
    font,
  );

  const MAJOR_STATION_LABELS = ["highSpeedRail", "trainStation", "busStation", "mrtStation"];
  (input.majorStation.items as any[]).forEach((item, i) => {
    const row = coordinates.majorStation[i];
    if (!row) {
      console.warn(
        `trafficAndTransport: missing coordinates for majorStation.${MAJOR_STATION_LABELS[i]}, skipping`,
      );
      return;
    }
    fillStationRow(page, item, row, font);
  });

  const busStop = input.busStop.value;
  const busStopCoords = coordinates.busStop;
  page.drawText(busStop.name, {
    x: busStopCoords.nameX,
    y: busStopCoords.nameY,
    size: FONT_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
  if (busStop.inSection === true)
    fillCircle(page, busStopCoords.inSectionX, busStopCoords.inSectionY, font);
  if (busStop.inSection === false) {
    fillCircle(page, busStopCoords.outSectionX, busStopCoords.outSectionY, font);
  }
  if (busStop.distanceValue !== undefined) {
    drawRightAligned(
      page,
      String(busStop.distanceValue),
      busStopCoords.distanceEndX,
      busStopCoords.distanceY,
      font,
    );
  }
  fillCircle(
    page,
    busStopCoords.densityOptionX[busStop.densityLevel]!,
    busStopCoords.densityOptionY[busStop.densityLevel]!,
    font,
  );

  const interchange = input.interchange.value;
  const interchangeCoords = coordinates.interchange;
  if (interchange.isExist) {
    page.drawText(interchange.name, {
      x: interchangeCoords.nameX,
      y: interchangeCoords.nameY,
      size: FONT_SIZE,
      font,
      color: rgb(0, 0, 0),
    });
  }
  if (interchange.inSection === true)
    fillCircle(page, interchangeCoords.inSectionX, interchangeCoords.nameY, font);
  if (interchange.inSection === false) {
    fillCircle(page, interchangeCoords.outSectionX, interchangeCoords.nameY, font);
  }
  if (interchange.distanceValue !== undefined) {
    drawRightAligned(
      page,
      String(interchange.distanceValue),
      interchangeCoords.distanceEndX,
      interchangeCoords.distanceY,
      font,
    );
  }

  // All 4 are type=text; raw is never read here — it exists only for the model's own
  // consistency cross-check.
  for (const key of TEXT_FIELD_KEYS) {
    const text = input[key].value.text as string;
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

}

export { fillTrafficAndTransportContent };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStandaloneFill({
    outputDir: OUTPUT_DIR,
    fillContent: fillTrafficAndTransportContent,
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
