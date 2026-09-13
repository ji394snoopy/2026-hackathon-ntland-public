import AdmZip from "adm-zip";
import { read as readShapefile } from "shapefile";
import type { SoilFeature } from "./findSoilAtPoint.js";

// The zip's internal paths are BIG5-mojibake when read as UTF-8 (confirmed during
// planning), same situation as drainageQuality's WRA zips — entries are found by
// extension rather than an assumed path.
function findEntry(zip: AdmZip, extension: string): Buffer {
  const entry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith(extension));
  if (!entry) throw new Error(`No ${extension} entry found in zip`);
  const data = zip.readFile(entry);
  if (!data) throw new Error(`Failed to read ${entry.entryName} from zip`);
  return data;
}

// Parses the downloaded national soil-map zip Buffer into SoilFeature[]. Unlike
// drainageQuality's WRA layers (UTF-8 DBF), this dataset's DBF is BIG5-encoded —
// confirmed live during planning (UTF-8 decoding produced mojibake Chinese text, BIG5
// didn't). Every DBF property is normalized to a string, same convention as
// drainageQuality/extractLayer.ts. Not unit tested — zip/shapefile-format glue, verified
// by an actual `npm run fetch:soil` run (see README).
async function extractSoilMap(zipBuffer: Buffer): Promise<SoilFeature[]> {
  const zip = new AdmZip(zipBuffer);
  const shp = findEntry(zip, ".shp");
  const dbf = findEntry(zip, ".dbf");

  const collection = await readShapefile(shp, dbf, { encoding: "big5" });

  return collection.features.map((feature): SoilFeature => {
    const properties: Record<string, string> = {};
    for (const [key, value] of Object.entries(feature.properties ?? {})) {
      properties[key] = value == null ? "" : String(value);
    }
    return {
      properties,
      geometry: feature.geometry as SoilFeature["geometry"],
    };
  });
}

export { extractSoilMap };
