import AdmZip from "adm-zip";
import { read as readShapefile } from "shapefile";

// The WDMS-WGS84 zip nests its .shp/.dbf at one folder deep (WDMS-WGS84-<date>/...),
// confirmed by downloading and inspecting a real snapshot while surveying this data
// source — found by extension rather than an assumed path, same as
// drainageQuality/extractLayer.ts.
function findEntry(zip: AdmZip, extension: string): Buffer {
  const entry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith(extension));
  if (!entry) throw new Error(`No ${extension} entry found in WDMS zip`);
  const data = zip.readFile(entry);
  if (!data) throw new Error(`Failed to read ${entry.entryName} from WDMS zip`);
  return data;
}

// The DBF's .cpg sidecar (confirmed live) declares Big5, not UTF-8 — every other
// shapefile source in this repo (drainageQuality, soilQuality) happens to be UTF-8, so
// this is the first one that needs an explicit non-default encoding. Not unit tested —
// zip/shapefile-format glue, verified by an actual `npm run fetch:waste-dumping` run
// (see README).
async function extractWasteDumpingFeatures(zipBuffer: Buffer): Promise<unknown[]> {
  const zip = new AdmZip(zipBuffer);
  const shp = findEntry(zip, ".shp");
  const dbf = findEntry(zip, ".dbf");

  const collection = await readShapefile(shp, dbf, { encoding: "big5" });
  return collection.features;
}

export { extractWasteDumpingFeatures };
