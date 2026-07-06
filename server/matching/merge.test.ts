import { describe, expect, it } from "vitest";
import { cheapestInsertion, type MergeTargetRoute } from "./merge";

const baseRoute: MergeTargetRoute = {
  routeIndex: 0,
  stops: [
    { clusterId: 1, lat: 37.5, lng: 127.0, seats: 10, order: 0, pickupTime: new Date("2026-08-01T17:00:00Z") },
    { clusterId: 2, lat: 37.51, lng: 127.02, seats: 10, order: 1, pickupTime: new Date("2026-08-01T17:15:00Z") },
  ],
  totalSeats: 20,
  maxCapacitySeats: 45,
};

const params = { maxDetourMinutes: 15, maxDetourKm: 10, avgSpeedKmh: 30 };
const venue = { lat: 37.52, lng: 127.04 };

describe("cheapestInsertion", () => {
  it("merges a nearby leftover cluster at the cheapest position", () => {
    const leftover = [{ clusterId: 99, lat: 37.505, lng: 127.01, seats: 3 }];
    const result = cheapestInsertion(leftover, [baseRoute], params, venue);

    expect(result.unmerged.length).toBe(0);
    expect(result.merged.length).toBe(1);
    expect(result.merged[0].routeIndex).toBe(0);
  });

  it("leaves a far-away cluster unmerged when it exceeds max detour", () => {
    const leftover = [{ clusterId: 99, lat: 38.5, lng: 128.5, seats: 3 }];
    const result = cheapestInsertion(leftover, [baseRoute], params, venue);

    expect(result.merged.length).toBe(0);
    expect(result.unmerged.length).toBe(1);
  });

  it("leaves a capacity-exceeding cluster unmerged even when geographically close", () => {
    const leftover = [{ clusterId: 99, lat: 37.505, lng: 127.01, seats: 30 }];
    const result = cheapestInsertion(leftover, [baseRoute], params, venue);

    expect(result.merged.length).toBe(0);
    expect(result.unmerged.length).toBe(1);
  });

  it("merges a cluster sitting on the path from the last stop to the venue (end-of-route insertion is not penalized as a round trip)", () => {
    // Between baseRoute's last stop (37.51, 127.02) and venue (37.52, 127.04) -
    // inserting here should cost roughly the small detour off that direct line,
    // not haversine(lastStop, candidate) * 2 which the old prev===next===lastStop
    // bug would have computed and likely rejected as exceeding maxDetourKm.
    const leftover = [{ clusterId: 99, lat: 37.515, lng: 127.03, seats: 3 }];
    const result = cheapestInsertion(leftover, [baseRoute], params, venue);

    expect(result.merged.length).toBe(1);
    expect(result.merged[0].insertAtOrder).toBe(2);
    expect(result.merged[0].marginalCostMinutes).toBeLessThan(5);
  });

  it("does not let end-of-route insertion collapse to a zero-cost round trip", () => {
    const leftover = [{ clusterId: 99, lat: 37.515, lng: 127.03, seats: 3 }];
    const result = cheapestInsertion(leftover, [baseRoute], params, venue);

    const merged = result.merged[0];
    expect(merged).toBeDefined();
    expect(merged.marginalCostMinutes).toBeGreaterThan(0);
  });
});
