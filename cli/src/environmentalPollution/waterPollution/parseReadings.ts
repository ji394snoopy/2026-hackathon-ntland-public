interface WaterReadingItem {
  itemname: string;
  itemengabbreviation: string;
  itemvalue: string;
  itemunit: string;
}

interface WaterReading {
  siteid: string;
  sampledate: string;
  items: WaterReadingItem[];
}

interface WaterMeasurementRecord {
  siteid?: unknown;
  sampledate?: unknown;
  itemname?: unknown;
  itemengabbreviation?: unknown;
  itemvalue?: unknown;
  itemunit?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// WQX_P_01 has no working server-side filter (siteid/itemname query params are
// confirmed live to be silently ignored), so every caller must filter client-side
// across whatever batch it fetched. Groups the given siteid's rows by sampledate and
// returns only the most recent group — one row per measured item, e.g. RPI, WT, pH.
function pickLatestReadingForSite(records: unknown[], siteid: string): WaterReading | null {
  const matching = (records as WaterMeasurementRecord[]).filter((r) => asString(r.siteid) === siteid);
  if (matching.length === 0) return null;

  const latestDate = matching.reduce(
    (latest, r) => (asString(r.sampledate) > latest ? asString(r.sampledate) : latest),
    "",
  );

  const items = matching
    .filter((r) => asString(r.sampledate) === latestDate)
    .map((r) => ({
      itemname: asString(r.itemname),
      itemengabbreviation: asString(r.itemengabbreviation),
      itemvalue: asString(r.itemvalue),
      itemunit: asString(r.itemunit),
    }));

  return { siteid, sampledate: latestDate, items };
}

export { pickLatestReadingForSite };
export type { WaterReading, WaterReadingItem };
