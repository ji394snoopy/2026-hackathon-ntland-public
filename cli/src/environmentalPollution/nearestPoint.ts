const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

interface PointCandidate<T> {
  lon: number;
  lat: number;
  record: T;
}

interface NearestPointResult<T> {
  record: T;
  metersToCenter: number;
}

function findNearestPoint<T>(candidates: PointCandidate<T>[], targetLon: number, targetLat: number): NearestPointResult<T> | null {
  let nearest: NearestPointResult<T> | null = null;
  for (const candidate of candidates) {
    const metersToCenter = haversineDistanceMeters(targetLat, targetLon, candidate.lat, candidate.lon);
    if (nearest === null || metersToCenter < nearest.metersToCenter) {
      nearest = { record: candidate.record, metersToCenter: Math.round(metersToCenter) };
    }
  }
  return nearest;
}

export { findNearestPoint, haversineDistanceMeters };
export type { PointCandidate, NearestPointResult };
