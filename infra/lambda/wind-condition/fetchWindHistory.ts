const ARCHIVE_API_URL = "https://archive-api.open-meteo.com/v1/archive";

interface DailyWindSeries {
  dates: string[];
  windSpeedMaxKmh: (number | null)[];
  windDirectionDominantDeg: (number | null)[];
}

function parseArchiveResponse(json: unknown): DailyWindSeries {
  const daily = (json as { daily?: unknown })?.daily as
    | { time?: unknown; windspeed_10m_max?: unknown; winddirection_10m_dominant?: unknown }
    | undefined;
  if (!daily || !Array.isArray(daily.time) || !Array.isArray(daily.windspeed_10m_max) || !Array.isArray(daily.winddirection_10m_dominant)) {
    throw new Error("parseArchiveResponse: response is missing the expected 'daily' block");
  }
  return {
    dates: daily.time as string[],
    windSpeedMaxKmh: daily.windspeed_10m_max as (number | null)[],
    windDirectionDominantDeg: daily.winddirection_10m_dominant as (number | null)[],
  };
}

async function fetchWindHistory(
  lon: number,
  lat: number,
  startDate: string,
  endDate: string,
): Promise<DailyWindSeries> {
  const url =
    `${ARCHIVE_API_URL}?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}` +
    `&daily=windspeed_10m_max,winddirection_10m_dominant&timezone=Asia%2FTaipei`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo archive request failed (${response.status} ${response.statusText}): ${url}`);
  }
  return parseArchiveResponse(await response.json());
}

export { fetchWindHistory, parseArchiveResponse };
export type { DailyWindSeries };
