import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pastYearRange } from "./dateRange.js";
import { fetchWindHistory } from "./fetchWindHistory.js";
import { meanWindSpeed, circularMeanDirectionDeg, compassBucket } from "./windStats.js";

const OUTPUT_DIR = "./src/windCondition/output";

function parseCoordinates(lonArg?: string, latArg?: string): { lon: number; lat: number } {
  const lon = Number(lonArg);
  const lat = Number(latArg);
  if (!lonArg || !latArg || Number.isNaN(lon) || Number.isNaN(lat)) {
    throw new Error("Usage: main.ts <lon> <lat>. Example: main.ts 121.4627 25.0111 (板橋, New Taipei City)");
  }
  return { lon, lat };
}

async function main() {
  const [, , lonArg, latArg] = process.argv;
  const { lon, lat } = parseCoordinates(lonArg, latArg);

  const { startDate, endDate } = pastYearRange(new Date());
  console.log(`Fetching Open-Meteo daily wind history for (${lon}, ${lat}) from ${startDate} to ${endDate}...`);
  const series = await fetchWindHistory(lon, lat, startDate, endDate);

  const avgDailyMaxWindSpeedKmh = meanWindSpeed(series.windSpeedMaxKmh);
  const dominantWindDirectionDeg = circularMeanDirectionDeg(series.windDirectionDominantDeg);
  const compass = compassBucket(dominantWindDirectionDeg);

  const output = {
    lon,
    lat,
    period: { startDate, endDate },
    sampleDays: series.dates.length,
    avgDailyMaxWindSpeedKmh: Math.round(avgDailyMaxWindSpeedKmh * 10) / 10,
    dominantWindDirectionDeg: Math.round(dominantWindDirectionDeg * 10) / 10,
    dominantWindDirectionCompass: compass,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = `${OUTPUT_DIR}/result.json`;
  writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(JSON.stringify(output, null, 2));
  console.log(`Wrote ${outputPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { parseCoordinates };
