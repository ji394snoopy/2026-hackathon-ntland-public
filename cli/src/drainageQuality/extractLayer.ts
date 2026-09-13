import AdmZip from "adm-zip";
import { read as readShapefile } from "shapefile";
import type { LayerFeature } from "./nearestFeature.js";

// Each WRA layer zip nests its .shp/.dbf at a different internal path (root-level for
// REGDAREA, one folder deep for PUMP_DRAIN/DIKEGATE, two folders deep for rivdike) —
// confirmed by downloading and inspecting all 4 while surveying data sources — so
// entries are found by extension rather than an assumed path.
function findEntry(zip: AdmZip, extension: string): Buffer {
  const entry = zip
    .getEntries()
    .find((e) => e.entryName.toLowerCase().endsWith(extension));
  if (!entry) throw new Error(`No ${extension} entry found in zip`);
  const data = zip.readFile(entry);
  if (!data) throw new Error(`Failed to read ${entry.entryName} from zip`);
  return data;
}

// Parses a downloaded layer's zip Buffer into LayerFeature[], normalizing every DBF
// property to a string (the `shapefile` library types numeric DBF fields as `number`,
// but every layer/nearestFeature helper in this module treats properties as strings,
// matching how the raw shapefile text values are actually used — as labels/county
// names, never arithmetic). Not unit tested — zip/shapefile-format glue, verified by an
// actual `npm run fetch:drainage` run (see README).
async function extractLayer(zipBuffer: Buffer): Promise<LayerFeature[]> {
  const zip = new AdmZip(zipBuffer);
  const shp = findEntry(zip, ".shp");
  const dbf = findEntry(zip, ".dbf");

  const collection = await readShapefile(shp, dbf, { encoding: "utf-8" });

  return collection.features.map((feature): LayerFeature => {
    const properties: Record<string, string> = {};
    for (const [key, value] of Object.entries(feature.properties ?? {})) {
      properties[key] = value == null ? "" : String(value);
    }
    return {
      properties,
      geometry: feature.geometry as LayerFeature["geometry"],
    };
  });
}

export { extractLayer };
