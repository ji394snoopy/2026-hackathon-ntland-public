// Keyless NLSC point-to-administrative-area lookup. Confirmed live: reliably
// distinguishes 新北市 from every other county (including 臺北市), and still resolves to
// *some* real county for an out-of-Taiwan-bounds point rather than erroring — so it has
// no natural "out of Taiwan" signal, but that's not needed here, only New Taipei vs. not.
const TOWN_VILLAGE_QUERY_URL = "https://api.nlsc.gov.tw/other/TownVillagePointQuery";

interface TownVillageInfo {
  ctyName: string;
  townName: string;
}

const CTY_NAME_RE = /<ctyName>([^<]*)<\/ctyName>/;
const TOWN_NAME_RE = /<townName>([^<]*)<\/townName>/;

// Small regex extraction rather than a full XML parser dependency — the response shape
// is fixed and simple (see the real captured example in resolveCity.test.ts), and this
// module only ever needs these two fields out of it.
function parseTownVillageXml(xml: string): TownVillageInfo | null {
  const ctyMatch = CTY_NAME_RE.exec(xml);
  const townMatch = TOWN_NAME_RE.exec(xml);
  if (!ctyMatch || !townMatch || !ctyMatch[1] || !townMatch[1]) return null;
  return { ctyName: ctyMatch[1], townName: townMatch[1] };
}

async function fetchTownVillage(lon: number, lat: number): Promise<TownVillageInfo | null> {
  const url = `${TOWN_VILLAGE_QUERY_URL}/${lon}/${lat}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TownVillagePointQuery failed (${response.status} ${response.statusText}): ${url}`);
  }
  return parseTownVillageXml(await response.text());
}

export { parseTownVillageXml, fetchTownVillage };
export type { TownVillageInfo };
