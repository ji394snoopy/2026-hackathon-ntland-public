import { pastYearRange } from "./dateRange.js";
import { fetchWindHistory } from "./fetchWindHistory.js";
import { meanWindSpeed, circularMeanDirectionDeg, compassBucket } from "./windStats.js";

// AWS Lambda Function URL event/response shapes (subset we use). Kept inline so the
// handler has no aws-lambda type dependency to bundle.
interface FunctionUrlEvent {
  queryStringParameters?: Record<string, string | undefined> | null;
}

interface JsonResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
} as const;

function parseCoordinates(
  lonArg: string | undefined,
  latArg: string | undefined,
): { lon: number; lat: number } {
  const lon = Number(lonArg);
  const lat = Number(latArg);
  if (!lonArg || !latArg || Number.isNaN(lon) || Number.isNaN(lat)) {
    throw new Error(
      "Missing or invalid coordinates. Pass ?lon=<lon>&lat=<lat>, e.g. ?lon=121.4627&lat=25.0111 (板橋, New Taipei City).",
    );
  }
  return { lon, lat };
}

/**
 * windCondition as a Lambda Function URL handler.
 *
 * GET ?lon=<lon>&lat=<lat> -> JSON with the past-year average daily-max wind speed and
 * the dominant wind direction. Pure Open-Meteo Archive API call, no AWS creds / no DB.
 */
export async function handler(event: FunctionUrlEvent): Promise<JsonResponse> {
  try {
    const params = event.queryStringParameters ?? {};
    const { lon, lat } = parseCoordinates(params.lon, params.lat);

    const { startDate, endDate } = pastYearRange(new Date());
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

    return { statusCode: 200, headers: { ...JSON_HEADERS }, body: JSON.stringify(output) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A bad/missing coordinate is a client error; anything else is upstream/unknown.
    const statusCode = message.startsWith("Missing or invalid coordinates") ? 400 : 502;
    return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify({ error: message }) };
  }
}
