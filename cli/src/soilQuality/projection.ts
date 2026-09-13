import proj4 from "proj4";

// TWD97 TM2 zone 121 (EPSG:3826) — confirmed identical projection parameters to
// drainageQuality's WRA layers despite a different PROJCS vendor label
// ("TWD_1997_TM_Taiwan" here vs. "TWD97_TM2_zone_121" there): central meridian 121°E,
// false easting 250000, false northing 0, scale factor 0.9999, on the GRS80
// ellipsoid/TWD97 datum.
const TWD97_TM2_DEF =
  "+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
const WGS84_DEF = "+proj=longlat +datum=WGS84 +no_defs";

const twd97Tm2 = proj4(WGS84_DEF, TWD97_TM2_DEF);

// Reprojects a single WGS84 (lon, lat) query point to TWD97 TM2 meters — called once
// per lookup, not per polygon vertex, since the soil map's native geometry is already
// in this CRS and is left untouched.
function toTwd97Tm2(lon: number, lat: number): [number, number] {
  return twd97Tm2.forward([lon, lat]);
}

function fromTwd97Tm2(x: number, y: number): [number, number] {
  return twd97Tm2.inverse([x, y]);
}

export { toTwd97Tm2, fromTwd97Tm2 };
