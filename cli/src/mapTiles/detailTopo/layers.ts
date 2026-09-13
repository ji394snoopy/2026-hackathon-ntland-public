import { lonLatToWebMercator } from "./nlscWmts.js";

// This CLI only supports New Taipei City — GetCapabilities' ows:Title is the
// documented human-readable field, so filtering on it (rather than the incidental
// TOPO01K_F01-F56 id-prefix pattern these 56 layers happen to share today) stays
// correct even if NLSC renumbers or adds a New Taipei district layer later.
const NEW_TAIPEI_TITLE_PREFIX = "新北市";

interface LayerBounds {
  id: string;
  title: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function parseLayerBounds(xml: string): LayerBounds[] {
  const layers: LayerBounds[] = [];
  for (const layerMatch of xml.matchAll(/<Layer>([\s\S]*?)<\/Layer>/g)) {
    const block = layerMatch[1]!;
    const id = /<ows:Identifier>([^<]+)<\/ows:Identifier>/.exec(block)?.[1];
    const title = /<ows:Title>([^<]+)<\/ows:Title>/.exec(block)?.[1];
    const bbox =
      /<ows:BoundingBox crs="urn:ogc:def:crs:EPSG::3857">\s*<ows:LowerCorner>([^<]+)<\/ows:LowerCorner>\s*<ows:UpperCorner>([^<]+)<\/ows:UpperCorner>/.exec(
        block,
      );
    if (!id || !title || !bbox) {
      console.warn(
        `Skipping layer block missing id/title/bbox: ${block.slice(0, 80)}...`,
      );
      continue;
    }
    const [minX, minY] = bbox[1]!.trim().split(/\s+/).map(Number);
    const [maxX, maxY] = bbox[2]!.trim().split(/\s+/).map(Number);
    layers.push({
      id,
      title,
      minX: minX!,
      minY: minY!,
      maxX: maxX!,
      maxY: maxY!,
    });
  }
  return layers;
}

function isNewTaipeiLayer(layer: LayerBounds): boolean {
  return layer.title.startsWith(NEW_TAIPEI_TITLE_PREFIX);
}

// Matches both title styles NLSC publishes per district: the older
// "<district>都市計畫_105年" plan sheets and the newer "<district>區(111年修測)" resurvey
// sheets — both end with a bare year immediately followed by 年.
function parseSurveyYear(title: string): number {
  const match = /(\d+)年/.exec(title);
  if (!match) {
    throw new Error(`Could not parse a survey year out of layer title: ${title}`);
  }
  return Number(match[1]);
}

function pickNewestSurveyYear(layers: LayerBounds[]): LayerBounds | undefined {
  if (layers.length === 0) return undefined;
  return layers.reduce((newest, candidate) =>
    parseSurveyYear(candidate.title) > parseSurveyYear(newest.title) ? candidate : newest,
  );
}

function layerContainsPoint(layer: LayerBounds, x: number, y: number): boolean {
  return x >= layer.minX && x <= layer.maxX && y >= layer.minY && y <= layer.maxY;
}

function findLayerForPoint(
  layers: LayerBounds[],
  lon: number,
  lat: number,
): LayerBounds | undefined {
  const { x, y } = lonLatToWebMercator(lon, lat);
  return pickNewestSurveyYear(layers.filter((layer) => layerContainsPoint(layer, x, y)));
}

// Candidates to fill a specific blank tile — same point-containment + newest-survey-year
// logic as findLayerForPoint, but applied to that tile's own center coordinate (not the
// original query point) and returning every match sorted newest-first, not just the top
// one: bboxes are looser than real coverage (documented in README's Coverage section),
// so the newest-year match can turn out to have zero real content there — the caller
// fetches each in order and accepts the first that actually has data for that tile.
function rankLayersCoveringPoint(
  candidates: LayerBounds[],
  excludePrimaryId: string,
  lon: number,
  lat: number,
): LayerBounds[] {
  const { x, y } = lonLatToWebMercator(lon, lat);
  const covering = candidates.filter(
    (layer) => layer.id !== excludePrimaryId && layerContainsPoint(layer, x, y),
  );
  return covering.sort((a, b) => parseSurveyYear(b.title) - parseSurveyYear(a.title));
}

export {
  parseLayerBounds,
  isNewTaipeiLayer,
  parseSurveyYear,
  findLayerForPoint,
  rankLayersCoveringPoint,
};
export type { LayerBounds };
