const CATEGORY_NAMES = [
  "landImprovement",
  "specialFacilities",
  "commercialActivity",
  "landUseRegulation",
  "trafficAndTransport",
  "publicInfrastructure",
  "environmentalPollution",
  "naturalConditions",
] as const;

type CategoryName = (typeof CATEGORY_NAMES)[number];

export { CATEGORY_NAMES };
export type { CategoryName };
