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

/**
 * Greedy first-fit-decreasing bin packing by seat count. Determines how many
 * buses are needed and which demands share a bus, independent of stop order.
 */
export function binPackByCapacity<T extends { seats: number }>(
  demands: T[],
  maxCapacity: number
): T[][] {
  const sorted = [...demands].sort((a, b) => b.seats - a.seats);
  const bins: { items: T[]; used: number }[] = [];

  for (const demand of sorted) {
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

  return bins.map((b) => b.items);
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

function buildSingleRoute(
  demands: StopDemand[],
  params: RouteBuilderParams
): BuiltRoute {
  const venue: LatLng = { lat: params.venueLat, lng: params.venueLng };
  const initialTour = nearestNeighborTour(demands, venue);
  const tour = twoOptImprove(initialTour, venue);

  // Target arrival is the deadline shared by every stop in this route.
  const targetArrivalAt = demands[0].targetArrivalAt;

  const pickupTimes: Date[] = new Array(tour.length);
  let nextPointTime = targetArrivalAt.getTime();
  let nextPoint: LatLng = venue;

  for (let i = tour.length - 1; i >= 0; i--) {
    const stop = tour[i];
    const travel = travelMinutes(stop, nextPoint, params.avgSpeedKmh);
    const pickupTime = new Date(nextPointTime - travel * 60000 - params.stopDwellMinutes * 60000);
    pickupTimes[i] = pickupTime;
    nextPointTime = pickupTime.getTime();
    nextPoint = stop;
  }

  const stops: RouteStop[] = tour.map((demand, index) => ({
    clusterId: demand.clusterId,
    lat: demand.lat,
    lng: demand.lng,
    seats: demand.seats,
    order: index,
    pickupTime: pickupTimes[index],
  }));

  const totalSeats = demands.reduce((sum, d) => sum + d.seats, 0);

  return {
    stops,
    totalSeats,
    departureAt: stops[0]?.pickupTime ?? targetArrivalAt,
    estimatedArrivalAt: targetArrivalAt,
  };
}

export function buildRoutes(demands: StopDemand[], params: RouteBuilderParams): BuiltRoute[] {
  if (demands.length === 0) return [];

  const bins = binPackByCapacity(demands, params.maxCapacitySeats);
  return bins.map((bin) => buildSingleRoute(bin, params));
}
