import { haversineMeters, type LatLng } from "./haversine";

export interface WeightedPoint extends LatLng {
  weight?: number;
}

/**
 * Weiszfeld's algorithm for the geometric median (Weber point), using haversine
 * distance as the metric. Weiszfeld is derived for Euclidean space; for clusters
 * spanning at most a few km this is a fine local-flat approximation.
 */
export function weiszfeldMedian(
  points: WeightedPoint[],
  opts?: { maxIterations?: number; tolerance?: number }
): LatLng {
  if (points.length === 0) {
    throw new Error("weiszfeldMedian requires at least one point");
  }
  if (points.length === 1) {
    return { lat: points[0].lat, lng: points[0].lng };
  }

  const maxIterations = opts?.maxIterations ?? 100;
  const toleranceMeters = opts?.tolerance ?? 1;

  const totalWeight = points.reduce((sum, p) => sum + (p.weight ?? 1), 0);
  let estimate: LatLng = {
    lat: points.reduce((sum, p) => sum + p.lat * (p.weight ?? 1), 0) / totalWeight,
    lng: points.reduce((sum, p) => sum + p.lng * (p.weight ?? 1), 0) / totalWeight,
  };

  for (let iter = 0; iter < maxIterations; iter++) {
    let numLat = 0;
    let numLng = 0;
    let den = 0;
    let coincident: WeightedPoint | null = null;

    for (const p of points) {
      const dist = haversineMeters(estimate, p);
      const weight = p.weight ?? 1;
      if (dist < 1e-6) {
        coincident = p;
        continue;
      }
      const inv = weight / dist;
      numLat += p.lat * inv;
      numLng += p.lng * inv;
      den += inv;
    }

    if (coincident && den === 0) {
      // Estimate coincides with the only remaining point.
      return { lat: coincident.lat, lng: coincident.lng };
    }

    const next: LatLng = {
      lat: den === 0 ? estimate.lat : numLat / den,
      lng: den === 0 ? estimate.lng : numLng / den,
    };

    const moved = haversineMeters(estimate, next);
    estimate = next;
    if (moved < toleranceMeters) break;
  }

  return estimate;
}

export function snapToNearestStop<T extends LatLng & { id: number }>(
  point: LatLng,
  candidates: T[],
  maxSnapDistanceMeters: number
): { stop: T; distanceMeters: number } | null {
  let best: { stop: T; distanceMeters: number } | null = null;

  for (const candidate of candidates) {
    const distance = haversineMeters(point, candidate);
    if (!best || distance < best.distanceMeters) {
      best = { stop: candidate, distanceMeters: distance };
    }
  }

  if (!best || best.distanceMeters > maxSnapDistanceMeters) return null;
  return best;
}
