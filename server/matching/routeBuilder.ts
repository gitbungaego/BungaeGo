import { haversineMeters, type LatLng } from "./haversine";

export interface StopDemand {
  clusterId: number;
  lat: number;
  lng: number;
  seats: number;
  targetArrivalAt: Date;
}

export interface RouteStop {
  clusterId: number;
  lat: number;
  lng: number;
  seats: number;
  order: number;
  pickupTime: Date;
}

export interface BuiltRoute {
  stops: RouteStop[];
  totalSeats: number;
  departureAt: Date;
  estimatedArrivalAt: Date;
}

export interface RouteBuilderParams {
  maxCapacitySeats: number;
  minCapacitySeats: number;
  avgSpeedKmh: number;
  stopDwellMinutes: number;
  venueLat: number;
  venueLng: number;
}

function travelMinutes(a: LatLng, b: LatLng, avgSpeedKmh: number): number {
  const km = haversineMeters(a, b) / 1000;
  return (km / avgSpeedKmh) * 60;
}

export interface BinPackResult<T> {
  bins: T[][];
  /** Demands whose seat count alone exceeds maxCapacity - DBSCAN clusters
   * by geographic proximity with no seat-count ceiling, so a single demand
   * can legitimately need more seats than one bus holds. These can't be
   * placed in any bin (every bin would exceed capacity from this one item
   * alone), so they're reported separately instead of silently becoming
   * an over-capacity bin. */
  oversized: T[];
}

/**
 * Greedy first-fit-decreasing bin packing by seat count. Determines how many
 * buses are needed and which demands share a bus, independent of stop order.
 */
export function binPackByCapacity<T extends { seats: number }>(
  demands: T[],
  maxCapacity: number
): BinPackResult<T> {
  const sorted = [...demands].sort((a, b) => b.seats - a.seats);
  const bins: { items: T[]; used: number }[] = [];
  const oversized: T[] = [];

  for (const demand of sorted) {
    if (demand.seats > maxCapacity) {
      oversized.push(demand);
      continue;
    }
    let placed = false;
    for (const bin of bins) {
      if (bin.used + demand.seats <= maxCapacity) {
        bin.items.push(demand);
        bin.used += demand.seats;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bins.push({ items: [demand], used: demand.seats });
    }
  }

  return { bins: bins.map((b) => b.items), oversized };
}

/**
 * Nearest-neighbor construction. Starts from the stop farthest from the venue
 * (buses drive toward the venue, so the last stop before the venue should be
 * the closest one) and greedily visits the nearest unvisited stop next.
 */
export function nearestNeighborTour<T extends LatLng>(stops: T[], venue: LatLng): T[] {
  if (stops.length <= 1) return [...stops];

  const remaining = [...stops];
  let startIdx = 0;
  let maxDist = -Infinity;
  for (let i = 0; i < remaining.length; i++) {
    const d = haversineMeters(remaining[i], venue);
    if (d > maxDist) {
      maxDist = d;
      startIdx = i;
    }
  }

  const tour: T[] = [remaining.splice(startIdx, 1)[0]];
  while (remaining.length > 0) {
    const current = tour[tour.length - 1];
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(current, remaining[i]);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }
    tour.push(remaining.splice(nearestIdx, 1)[0]);
  }

  return tour;
}

function tourDistance<T extends LatLng>(tour: T[], venue: LatLng): number {
  let total = 0;
  for (let i = 0; i < tour.length - 1; i++) {
    total += haversineMeters(tour[i], tour[i + 1]);
  }
  if (tour.length > 0) {
    total += haversineMeters(tour[tour.length - 1], venue);
  }
  return total;
}

/**
 * 2-opt local search: for each pair of edges, reverse the segment between them
 * if it reduces total tour distance (including the final leg to the venue).
 * Repeats until no improving swap is found or maxIterations is hit.
 */
export function twoOptImprove<T extends LatLng>(
  tour: T[],
  venue: LatLng,
  maxIterations = 200
): T[] {
  if (tour.length < 3) return [...tour];

  let best = [...tour];
  let bestDistance = tourDistance(best, venue);
  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIterations) {
    improved = false;
    for (let i = 0; i < best.length - 1 && !improved; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        const candidateDistance = tourDistance(candidate, venue);
        if (candidateDistance < bestDistance - 1e-9) {
          best = candidate;
          bestDistance = candidateDistance;
          improved = true;
          break;
        }
      }
      iterations++;
      if (iterations >= maxIterations) break;
    }
  }

  return best;
}

/**
 * Back-calculates each stop's pickup time by working backward from the
 * target arrival at the venue: last stop -> venue leg first, then each
 * preceding stop, subtracting travel time and dwell time at every step.
 * Reusable after any operation that changes a route's stop order or count
 * (e.g. cheapest-insertion merge) - not just initial construction - so the
 * schedule always reflects the actual, current stop sequence.
 */
export function recomputePickupTimes<T extends LatLng>(
  orderedStops: T[],
  venue: LatLng,
  targetArrivalAt: Date,
  avgSpeedKmh: number,
  stopDwellMinutes: number
): (T & { pickupTime: Date })[] {
  const pickupTimes: Date[] = new Array(orderedStops.length);
  let nextPointTime = targetArrivalAt.getTime();
  let nextPoint: LatLng = venue;

  for (let i = orderedStops.length - 1; i >= 0; i--) {
    const stop = orderedStops[i];
    const travel = travelMinutes(stop, nextPoint, avgSpeedKmh);
    const pickupTime = new Date(nextPointTime - travel * 60000 - stopDwellMinutes * 60000);
    pickupTimes[i] = pickupTime;
    nextPointTime = pickupTime.getTime();
    nextPoint = stop;
  }

  return orderedStops.map((stop, index) => ({ ...stop, pickupTime: pickupTimes[index] }));
}

function buildSingleRoute(
  demands: StopDemand[],
  params: RouteBuilderParams
): BuiltRoute {
  const venue: LatLng = { lat: params.venueLat, lng: params.venueLng };
  const initialTour = nearestNeighborTour(demands, venue);
  const tour = twoOptImprove(initialTour, venue);

  // Target arrival is the deadline shared by every stop in this route.
  const targetArrivalAt = demands[0].targetArrivalAt;

  const stopsWithTimes = recomputePickupTimes(
    tour.map((demand) => ({ clusterId: demand.clusterId, lat: demand.lat, lng: demand.lng, seats: demand.seats })),
    venue,
    targetArrivalAt,
    params.avgSpeedKmh,
    params.stopDwellMinutes
  );

  const stops: RouteStop[] = stopsWithTimes.map((stop, index) => ({ ...stop, order: index }));

  const totalSeats = demands.reduce((sum, d) => sum + d.seats, 0);

  return {
    stops,
    totalSeats,
    departureAt: stops[0]?.pickupTime ?? targetArrivalAt,
    estimatedArrivalAt: targetArrivalAt,
  };
}

export interface BuildRoutesResult {
  routes: BuiltRoute[];
  /** Demands that alone exceed maxCapacitySeats and so couldn't be placed
   * on any bus - see BinPackResult.oversized. */
  oversizedDemands: StopDemand[];
}

export function buildRoutes(demands: StopDemand[], params: RouteBuilderParams): BuildRoutesResult {
  if (demands.length === 0) return { routes: [], oversizedDemands: [] };

  const { bins, oversized } = binPackByCapacity(demands, params.maxCapacitySeats);
  return {
    routes: bins.map((bin) => buildSingleRoute(bin, params)),
    oversizedDemands: oversized,
  };
}
