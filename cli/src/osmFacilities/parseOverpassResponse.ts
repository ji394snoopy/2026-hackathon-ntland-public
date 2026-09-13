interface OsmMatch {
  tag: string;
  name: string | null;
  lat: number;
  lon: number;
}

interface OverpassElement {
  type?: unknown;
  id?: unknown;
  lat?: unknown;
  lon?: unknown;
  center?: { lat?: unknown; lon?: unknown };
  tags?: { name?: unknown };
}

function elementCoords(element: OverpassElement): { lat: number; lon: number } | undefined {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { lat: element.lat, lon: element.lon };
  }
  const center = element.center;
  if (center && typeof center.lat === "number" && typeof center.lon === "number") {
    return { lat: center.lat, lon: center.lon };
  }
  return undefined;
}

function parseOverpassResponse(json: unknown, tagLabel: string): OsmMatch[] {
  const elements = (json as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) {
    throw new Error("parseOverpassResponse: response is missing the expected 'elements' array");
  }

  const matches: OsmMatch[] = [];
  for (const element of elements as OverpassElement[]) {
    const coords = elementCoords(element);
    if (!coords) {
      console.warn(`parseOverpassResponse: skipping element ${element.id} — no usable coordinates`);
      continue;
    }
    const name = typeof element.tags?.name === "string" ? element.tags.name : null;
    matches.push({ tag: tagLabel, name, lat: coords.lat, lon: coords.lon });
  }
  return matches;
}

export { parseOverpassResponse };
export type { OsmMatch };
