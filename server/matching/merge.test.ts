import { describe, expect, it } from "vitest";
import { cheapestInsertion, type MergeTargetRoute } from "./merge";
import { recomputePickupTimes } from "./routeBuilder";
import { haversineMeters } from "./haversine";

// cheapestInsertion mutates the route objects it's given in place, so each
// test needs its own fresh route - sharing one const across it() blocks would
// let one test's merge (extra stop, shifted totalSeats) leak into the next.
function createBaseRoute(): MergeTargetRoute {
  return {
    routeIndex: 0,
    stops: [
      { clusterId: 1, lat: 37.5, lng: 127.0, seats: 10, order: 0, pickupTime: new Date("2026-08-01T17:00:00Z") },
      { clusterId: 2, lat: 37.51, lng: 127.02, seats: 10, order: 1, pickupTime: new Date("2026-08-01T17:15:00Z") },
    ],
    totalSeats: 20,
    maxCapacitySeats: 45,
    targetArrivalAt: new Date("2026-08-01T17:30:00Z"),
    stopDwellMinutes: 3,
  };
}

const params = { maxDetourMinutes: 15, maxDetourKm: 10, avgSpeedKmh: 30 };
const venue = { lat: 37.52, lng: 127.04 };

describe("cheapestInsertion", () => {
  it("merges a nearby leftover cluster at the cheapest position", () => {
    const leftover = [{ clusterId: 99, lat: 37.505, lng: 127.01, seats: 3 }];
    const result = cheapestInsertion(leftover, [createBaseRoute()], params, venue);

    expect(result.unmerged.length).toBe(0);
    expect(result.merged.length).toBe(1);
    expect(result.merged[0].routeIndex).toBe(0);
  });

  it("leaves a far-away cluster unmerged when it exceeds max detour", () => {
    const leftover = [{ clusterId: 99, lat: 38.5, lng: 128.5, seats: 3 }];
    const result = cheapestInsertion(leftover, [createBaseRoute()], params, venue);

    expect(result.merged.length).toBe(0);
    expect(result.unmerged.length).toBe(1);
  });

  it("leaves a capacity-exceeding cluster unmerged even when geographically close", () => {
    const leftover = [{ clusterId: 99, lat: 37.505, lng: 127.01, seats: 30 }];
    const result = cheapestInsertion(leftover, [createBaseRoute()], params, venue);

    expect(result.merged.length).toBe(0);
    expect(result.unmerged.length).toBe(1);
  });

  it("merges a cluster sitting on the path from the last stop to the venue (end-of-route insertion is not penalized as a round trip)", () => {
    // Between baseRoute's last stop (37.51, 127.02) and venue (37.52, 127.04) -
    // inserting here should cost roughly the small detour off that direct line,
    // not haversine(lastStop, candidate) * 2 which the old prev===next===lastStop
    // bug would have computed and likely rejected as exceeding maxDetourKm.
    const leftover = [{ clusterId: 99, lat: 37.515, lng: 127.03, seats: 3 }];
    const result = cheapestInsertion(leftover, [createBaseRoute()], params, venue);

    expect(result.merged.length).toBe(1);
    expect(result.merged[0].insertAtOrder).toBe(2);
    expect(result.merged[0].marginalCostMinutes).toBeLessThan(5);
  });

  it("does not let end-of-route insertion collapse to a zero-cost round trip", () => {
    const leftover = [{ clusterId: 99, lat: 37.515, lng: 127.03, seats: 3 }];
    const result = cheapestInsertion(leftover, [createBaseRoute()], params, venue);

    const merged = result.merged[0];
    expect(merged).toBeDefined();
    expect(merged.marginalCostMinutes).toBeGreaterThan(0);
  });

  it("mutates the caller's route object in place (stops/totalSeats), not just an internal copy", () => {
    const route = createBaseRoute();
    const originalStopCount = route.stops.length;
    const originalTotalSeats = route.totalSeats;

    const leftover = [{ clusterId: 99, lat: 37.505, lng: 127.01, seats: 3 }];
    const result = cheapestInsertion(leftover, [route], params, venue);

    expect(result.merged.length).toBe(1);
    expect(route.stops.length).toBe(originalStopCount + 1);
    expect(route.totalSeats).toBe(originalTotalSeats + 3);
  });

  it("recomputes pickup times for the whole route so departureAt moves earlier to absorb the added detour, and the last leg still lands on the deadline", () => {
    const route = createBaseRoute();

    // The fixture's stop pickupTimes are hand-picked round numbers, not
    // necessarily what back-calculation from targetArrivalAt would produce
    // for these exact stop positions - so establish a self-consistent
    // "before" baseline the same way cheapestInsertion will after inserting,
    // rather than comparing against the arbitrary fixture values.
    const before = recomputePickupTimes(
      route.stops,
      venue,
      route.targetArrivalAt,
      params.avgSpeedKmh,
      route.stopDwellMinutes
    );
    const originalDepartureAt = before[0].pickupTime.getTime();

    // Same end-of-route insertion as above: adds real detour distance/time.
    const leftover = [{ clusterId: 99, lat: 37.515, lng: 127.03, seats: 3 }];
    const result = cheapestInsertion(leftover, [route], params, venue);

    expect(result.merged.length).toBe(1);
    expect(route.stops.length).toBe(3);

    // More total driving for the same targetArrivalAt => must depart earlier.
    expect(route.stops[0].pickupTime.getTime()).toBeLessThan(originalDepartureAt);

    // Times must strictly increase stop-to-stop after the back-calculation.
    for (let i = 0; i < route.stops.length - 1; i++) {
      expect(route.stops[i].pickupTime.getTime()).toBeLessThan(route.stops[i + 1].pickupTime.getTime());
    }

    // Last stop + travel to venue + dwell must land back on targetArrivalAt -
    // this is what "back-calculated from targetArrivalAt" actually means.
    const lastStop = route.stops[route.stops.length - 1];
    const travelToVenueMs =
      (haversineMeters(lastStop, venue) / 1000 / params.avgSpeedKmh) * 3600000;
    const expectedArrival = lastStop.pickupTime.getTime() + travelToVenueMs + route.stopDwellMinutes * 60000;
    expect(Math.abs(expectedArrival - route.targetArrivalAt.getTime())).toBeLessThan(1000);
  });
});
