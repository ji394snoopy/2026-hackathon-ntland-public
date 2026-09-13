interface ContaminationSite {
  site_id: string;
  site_name: string;
  county: string;
  township: string;
  site_type: string;
  site_use: string;
  pollutant: string;
  controltype: string;
  anno_date: string;
  sitearea: number;
  lon: number;
  lat: number;
}

interface ContaminationSiteRecord {
  site_id?: unknown;
  site_name?: unknown;
  county?: unknown;
  township?: unknown;
  site_type?: unknown;
  site_use?: unknown;
  pollutant?: unknown;
  controltype?: unknown;
  anno_date?: unknown;
  sitearea?: unknown;
  wgs84_lng?: unknown;
  wgs84_lat?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseContaminationSites(records: unknown[]): ContaminationSite[] {
  const sites: ContaminationSite[] = [];
  for (const raw of records as ContaminationSiteRecord[]) {
    const lon = Number(raw.wgs84_lng);
    const lat = Number(raw.wgs84_lat);
    if (!raw.wgs84_lng || !raw.wgs84_lat || Number.isNaN(lon) || Number.isNaN(lat)) {
      console.warn(`parseContaminationSites: skipping "${asString(raw.site_name)}" — no usable coordinates`);
      continue;
    }
    const sitearea = Number(raw.sitearea);
    sites.push({
      site_id: asString(raw.site_id),
      site_name: asString(raw.site_name),
      county: asString(raw.county),
      township: asString(raw.township),
      site_type: asString(raw.site_type),
      site_use: asString(raw.site_use),
      pollutant: asString(raw.pollutant),
      controltype: asString(raw.controltype),
      anno_date: asString(raw.anno_date),
      sitearea: Number.isNaN(sitearea) ? 0 : sitearea,
      lon,
      lat,
    });
  }
  return sites;
}

export { parseContaminationSites };
export type { ContaminationSite };
