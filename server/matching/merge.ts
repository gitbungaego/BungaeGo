import { haversineMeters, type LatLng } from "./haversine";
import type { RouteStop } from "./routeBuilder";

export interface MergeCandidateCluster {
  clusterId: number;
  lat: number;
  lng: number;
  seats: number;
}

export interface MergeTargetRoute {
  routeIndex: number;
  stops: RouteStop[];
  totalSeats: number;
  maxCapacitySeats: number;
}

export interface MergeParams {
  maxDetourMinutes: number;
  maxDetourKm: number;
  avgSpeedKmh: number;
}

export interface MergeResult {
  merged: Array<{
    clusterId: number;
    routeIndex: number;
    insertAtOrder: number;
    marginalCostMinutes: number;
  }>;
  unmerged: MergeCandidateCluster[];
}

function marginalDistanceKm(prev: LatLng, next: LatLng, candidate: LatLng): number {
  const withCandidate =
    haversineMeters(prev, candidate) + haversineMeters(candidate, next);
  const without = haversineMeters(prev, next);
  return (withCandidate - without) / 1000;
}

// Cost of inserting `candidate` as the new first stop: there's no leg before
// the current first stop to compare against, so the marginal cost is just the
// one-way distance to it (not prev===next===stops[0] collapsing to a round trip).
function prependDistanceKm(currentFirst: LatLng, candidate: LatLng): number {
  return haversineMeters(candidate, currentFirst) / 1000;
}

// Cost of inserting `candidate` after the last stop: the route's real final
// leg goes to the venue, so this must compare against (lastStop -> venue),
// not collapse to 0 like the middle-insertion formula would if next were
// treated as the last stop again.
function appendDistanceKm(currentLast: LatLng, candidate: LatLng, venue: LatLng): number {
  const withCandidate = haversineMeters(currentLast, candidate) + haversineMeters(candidate, venue);
  const without = haversineMeters(currentLast, venue);
  return (withCandidate - without) / 1000;
}

/**
 * Cheapest-insertion merge: leftover clusters (DBSCAN noise / sub-minPts groups)
 * are inserted into an existing route's stop sequence at the position with the
 * lowest marginal detour cost, if that cost stays within the configured bounds.
 * Processed largest-seats-first; each accepted insertion is committed immediately
 * (mutating an in-memory working copy of the route) before evaluating the next cluster.
 */
export function cheapestInsertion(
  leftoverClusters: MergeCandidateCluster[],
  routes: MergeTargetRoute[],
  params: MergeParams,
  venue: LatLng
): MergeResult {
  const workingRoutes = routes.map((r) => ({
    routeIndex: r.routeIndex,
    stops: [...r.stops],
    totalSeats: r.totalSeats,
    maxCapacitySeats: r.maxCapacitySeats,
  }));

  const merged: MergeResult["merged"] = [];
  const unmerged: MergeCandidateCluster[] = [];

  const ordered = [...leftoverClusters].sort((a, b) => b.seats - a.seats);

  for (const cluster of ordered) {
    let best: {
      route: (typeof workingRoutes)[number];
      insertAtOrder: number;
      marginalCostMinutes: number;
    } | null = null;

    for (const route of workingRoutes) {
      if (route.totalSeats + cluster.seats > route.maxCapacitySeats) continue;
      if (route.stops.length === 0) continue;

      for (let pos = 0; pos <= route.stops.length; pos++) {
        const detourKm =
          pos === 0
            ? prependDistanceKm(route.stops[0], cluster)
            : pos === route.stops.length
              ? appendDistanceKm(route.stops[route.stops.length - 1], cluster, venue)
              : marginalDistanceKm(route.stops[pos - 1], route.stops[pos], cluster);
        const detourMinutes = (detourKm / params.avgSpeedKmh) * 60;

        if (detourKm > params.maxDetourKm || detourMinutes > params.maxDetourMinutes) continue;

        if (!best || detourMinutes < best.marginalCostMinutes) {
          best = { route, insertAtOrder: pos, marginalCostMinutes: detourMinutes };
        }
      }
    }

    if (!best) {
      unmerged.push(cluster);
      continue;
    }

    const newStop: RouteStop = {
      clusterId: cluster.clusterId,
      lat: cluster.lat,
      lng: cluster.lng,
      seats: cluster.seats,
      order: best.insertAtOrder,
      pickupTime: best.route.stops[Math.min(best.insertAtOrder, best.route.stops.length - 1)].pickupTime,
    };
    best.route.stops.splice(best.insertAtOrder, 0, newStop);
    best.route.stops.forEach((s, i) => (s.order = i));
    best.route.totalSeats += cluster.seats;

    merged.push({
      clusterId: cluster.clusterId,
      routeIndex: best.route.routeIndex,
      insertAtOrder: best.insertAtOrder,
      marginalCostMinutes: best.marginalCostMinutes,
    });
  }

  return { merged, unmerged };
}
