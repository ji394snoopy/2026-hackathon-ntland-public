interface AqiStation {
  siteid: string;
  sitename: string;
  county: string;
  aqi: number;
  status: string;
  pollutant: string;
  publishtime: string;
  lon: number;
  lat: number;
}

interface AqiRecord {
  siteid?: unknown;
  sitename?: unknown;
  county?: unknown;
  aqi?: unknown;
  status?: unknown;
  pollutant?: unknown;
  publishtime?: unknown;
  longitude?: unknown;
  latitude?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseAqiStations(records: unknown[]): AqiStation[] {
  const stations: AqiStation[] = [];
  for (const raw of records as AqiRecord[]) {
    const lon = Number(raw.longitude);
    const lat = Number(raw.latitude);
    const aqi = Number(raw.aqi);
    if (Number.isNaN(lon) || Number.isNaN(lat)) {
      console.warn(`parseAqiStations: skipping "${asString(raw.sitename)}" — no usable coordinates`);
      continue;
    }
    stations.push({
      siteid: asString(raw.siteid),
      sitename: asString(raw.sitename),
      county: asString(raw.county),
      aqi: Number.isNaN(aqi) ? 0 : aqi,
      status: asString(raw.status),
      pollutant: asString(raw.pollutant),
      publishtime: asString(raw.publishtime),
      lon,
      lat,
    });
  }
  return stations;
}

export { parseAqiStations };
export type { AqiStation };
