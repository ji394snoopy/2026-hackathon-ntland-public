interface WaterStation {
  siteid: string;
  sitename: string;
  county: string;
  township: string;
  basin: string;
  river: string;
  statusofuse: string;
  lon: number;
  lat: number;
}

interface WaterStationRecord {
  siteid?: unknown;
  sitename?: unknown;
  county?: unknown;
  township?: unknown;
  basin?: unknown;
  river?: unknown;
  statusofuse?: unknown;
  twd97lon?: unknown;
  twd97lat?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// twd97lon/twd97lat are confirmed (live) to be plain WGS84 decimal degrees despite the
// name — the real TWD97 TM2 meters are the separate twd97tm2x/twd97tm2y fields, unused
// here.
function parseWaterStations(records: unknown[]): WaterStation[] {
  const stations: WaterStation[] = [];
  for (const raw of records as WaterStationRecord[]) {
    const lon = Number(raw.twd97lon);
    const lat = Number(raw.twd97lat);
    if (!raw.twd97lon || !raw.twd97lat || Number.isNaN(lon) || Number.isNaN(lat)) {
      console.warn(`parseWaterStations: skipping "${asString(raw.sitename)}" — no usable coordinates`);
      continue;
    }
    stations.push({
      siteid: asString(raw.siteid),
      sitename: asString(raw.sitename),
      county: asString(raw.county),
      township: asString(raw.township),
      basin: asString(raw.basin),
      river: asString(raw.river),
      statusofuse: asString(raw.statusofuse),
      lon,
      lat,
    });
  }
  return stations;
}

export { parseWaterStations };
export type { WaterStation };
