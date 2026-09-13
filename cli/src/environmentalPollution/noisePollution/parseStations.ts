interface NoiseStation {
  stationid: string;
  county: string;
  stationname: string;
  areatype: string;
  noisetype: string;
  address: string;
  status: string;
  sideroad: string;
  sideroadwidth: string;
  lon: number;
  lat: number;
}

interface NoiseStationRecord {
  stationid?: unknown;
  county?: unknown;
  stationname?: unknown;
  areatype?: unknown;
  noisetype?: unknown;
  address?: unknown;
  status?: unknown;
  sideroad?: unknown;
  sideroadwidth?: unknown;
  longitude?: unknown;
  latitude?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseNoiseStations(records: unknown[]): NoiseStation[] {
  const stations: NoiseStation[] = [];
  for (const raw of records as NoiseStationRecord[]) {
    const lon = Number(raw.longitude);
    const lat = Number(raw.latitude);
    if (!raw.longitude || !raw.latitude || Number.isNaN(lon) || Number.isNaN(lat)) {
      console.warn(`parseNoiseStations: skipping "${asString(raw.stationname)}" — no usable coordinates`);
      continue;
    }
    stations.push({
      stationid: asString(raw.stationid),
      county: asString(raw.county),
      stationname: asString(raw.stationname),
      areatype: asString(raw.areatype),
      noisetype: asString(raw.noisetype),
      address: asString(raw.address),
      status: asString(raw.status),
      sideroad: asString(raw.sideroad),
      sideroadwidth: asString(raw.sideroadwidth),
      lon,
      lat,
    });
  }
  return stations;
}

export { parseNoiseStations };
export type { NoiseStation };
