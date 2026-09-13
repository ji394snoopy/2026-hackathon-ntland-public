// The 4 WRA (經濟部水利署) 防洪排水 layers that describe drainage infrastructure/capacity
// — as opposed to a hazard simulation (淹水潛勢, deliberately out of scope) — downloadable
// keyless from gic.wra.gov.tw. Each layer's DBF schema differs (confirmed by downloading
// and inspecting all 4 while surveying data sources), so countyField/nameField are
// declared per layer rather than assumed shared.
type GeometryKind = "point" | "polygon" | "polyline";

interface DrainageLayer {
  wraCode: string; // the `fname` query param for DownLoad.aspx
  nameZh: string;
  nameEn: string;
  geometryKind: GeometryKind;
  countyField: string; // DBF field holding county info, checked via substring match
  displayNameField: string; // DBF field holding the feature's own name
}

const DRAINAGE_LAYERS: DrainageLayer[] = [
  {
    wraCode: "PUMP_DRAIN",
    nameZh: "抽水站",
    nameEn: "pumpingStation",
    geometryKind: "point",
    countyField: "ADMI_NAME", // e.g. "新北市三重區"
    displayNameField: "NAME",
  },
  {
    wraCode: "DIKEGATE",
    nameZh: "水門",
    nameEn: "floodgate",
    geometryKind: "point",
    countyField: "ADMI_NAME",
    displayNameField: "NAME",
  },
  {
    wraCode: "REGDAREA",
    nameZh: "中央管區域排水設施範圍",
    nameEn: "managedDrainageArea",
    geometryKind: "polygon",
    countyField: "COUN_NAME", // e.g. "新北市、桃園市" — "、"-delimited, can span counties
    displayNameField: "DRAIN_NAME",
  },
  {
    wraCode: "rivdike",
    nameZh: "中央管河川河堤",
    nameEn: "riverDike",
    geometryKind: "polyline",
    countyField: "County", // e.g. "新北市" — single value
    displayNameField: "Name",
  },
];

export { DRAINAGE_LAYERS };
export type { DrainageLayer, GeometryKind };
