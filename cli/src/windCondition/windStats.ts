interface CompassPoint {
  key: string;
  zh: string;
}

// Meteorological convention: direction is where the wind blows FROM.
const COMPASS_POINTS: CompassPoint[] = [
  { key: "N", zh: "北風" },
  { key: "NE", zh: "東北風" },
  { key: "E", zh: "東風" },
  { key: "SE", zh: "東南風" },
  { key: "S", zh: "南風" },
  { key: "SW", zh: "西南風" },
  { key: "W", zh: "西風" },
  { key: "NW", zh: "西北風" },
];

function meanWindSpeed(speeds: (number | null)[]): number {
  const valid = speeds.filter((s): s is number => s !== null);
  if (valid.length === 0) throw new Error("meanWindSpeed: no valid speed values");
  return valid.reduce((sum, s) => sum + s, 0) / valid.length;
}

// Angles wrap at 0/360, so a naive arithmetic mean breaks near the boundary (mean of
// 350 and 10 should be 0, not 180). Average the sin/cos vector components instead and
// convert back via atan2 — standard meteorological practice for averaging wind direction.
function circularMeanDirectionDeg(directions: (number | null)[]): number {
  const valid = directions.filter((d): d is number => d !== null);
  if (valid.length === 0) throw new Error("circularMeanDirectionDeg: no valid direction values");
  const sumSin = valid.reduce((sum, d) => sum + Math.sin((d * Math.PI) / 180), 0);
  const sumCos = valid.reduce((sum, d) => sum + Math.cos((d * Math.PI) / 180), 0);
  const meanRad = Math.atan2(sumSin / valid.length, sumCos / valid.length);
  const meanDeg = (meanRad * 180) / Math.PI;
  return (meanDeg + 360) % 360;
}

function compassBucket(degrees: number): CompassPoint {
  const normalized = ((degrees % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % 8;
  const point = COMPASS_POINTS[index];
  if (!point) throw new Error(`compassBucket: no compass point for index ${index}`);
  return point;
}

export { meanWindSpeed, circularMeanDirectionDeg, compassBucket };
export type { CompassPoint };
