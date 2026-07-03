import { haversineMeters } from "./haversine";

export interface DbscanPoint {
  id: number;
  lat: number;
  lng: number;
}

export interface DbscanParams {
  epsMeters: number;
  minPts: number;
}

export interface DbscanResult {
  clusters: DbscanPoint[][];
  noise: DbscanPoint[];
}

export function regionQuery(
  points: DbscanPoint[],
  point: DbscanPoint,
  epsMeters: number
): DbscanPoint[] {
  return points.filter((p) => haversineMeters(point, p) <= epsMeters);
}

const UNVISITED = -2;
const NOISE = -1;

export function dbscan(points: DbscanPoint[], params: DbscanParams): DbscanResult {
  const { epsMeters, minPts } = params;
  const labels = new Map<number, number>();
  for (const p of points) labels.set(p.id, UNVISITED);

  let clusterId = -1;

  for (const point of points) {
    if (labels.get(point.id) !== UNVISITED) continue;

    const neighbors = regionQuery(points, point, epsMeters);
    if (neighbors.length < minPts) {
      labels.set(point.id, NOISE);
      continue;
    }

    clusterId += 1;
    labels.set(point.id, clusterId);

    const queue = [...neighbors];
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i];
      const qLabel = labels.get(q.id);

      if (qLabel === NOISE) {
        labels.set(q.id, clusterId);
        continue;
      }
      if (qLabel !== UNVISITED) continue;

      labels.set(q.id, clusterId);
      const qNeighbors = regionQuery(points, q, epsMeters);
      if (qNeighbors.length >= minPts) {
        queue.push(...qNeighbors);
      }
    }
  }

  const clusterMap = new Map<number, DbscanPoint[]>();
  const noise: DbscanPoint[] = [];

  for (const point of points) {
    const label = labels.get(point.id)!;
    if (label === NOISE) {
      noise.push(point);
      continue;
    }
    const existing = clusterMap.get(label);
    if (existing) {
      existing.push(point);
    } else {
      clusterMap.set(label, [point]);
    }
  }

  const clusters = Array.from(clusterMap.values());
  return { clusters, noise };
}
