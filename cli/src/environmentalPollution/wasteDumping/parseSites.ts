interface WasteDumpingSite {
  caseId: string;
  county: string;
  district: string;
  address: string;
  siteName: string;
  wasteKind: string;
  lastUpdated: string;
  soilWaterControlled: string;
  siteStatus: string;
  lon: number;
  lat: number;
}

interface WdmsFeature {
  properties?: {
    案件編號?: unknown;
    縣市?: unknown;
    行政區?: unknown;
    地址?: unknown;
    場址名稱?: unknown;
    Lon?: unknown;
    Lat?: unknown;
    廢棄物種類?: unknown;
    最後更新日?: unknown;
    土水列管?: unknown;
    現場狀態?: unknown;
  };
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : String(value);
}

// The WDMS-WGS84 shapefile's DBF fields are the raw 資料字典 field names documented on
// the wr_p_244 dataset page (案件編號/縣市/行政區/... etc.), Big5-encoded — decoding is
// extractSites.ts's job, this function only maps the already-decoded feature properties.
function parseWasteDumpingSites(features: unknown[]): WasteDumpingSite[] {
  const sites: WasteDumpingSite[] = [];
  for (const feature of features as WdmsFeature[]) {
    const props = feature.properties ?? {};
    const lon = Number(props.Lon);
    const lat = Number(props.Lat);
    if (props.Lon == null || props.Lat == null || Number.isNaN(lon) || Number.isNaN(lat)) {
      console.warn(`parseWasteDumpingSites: skipping "${asString(props.場址名稱)}" — no usable coordinates`);
      continue;
    }
    sites.push({
      caseId: asString(props.案件編號),
      county: asString(props.縣市),
      district: asString(props.行政區),
      address: asString(props.地址),
      siteName: asString(props.場址名稱),
      wasteKind: asString(props.廢棄物種類),
      lastUpdated: asString(props.最後更新日),
      soilWaterControlled: asString(props.土水列管),
      siteStatus: asString(props.現場狀態),
      lon,
      lat,
    });
  }
  return sites;
}

export { parseWasteDumpingSites };
export type { WasteDumpingSite };
