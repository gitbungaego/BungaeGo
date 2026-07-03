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

describe("cheapestInsertion", () => {
  it("merges a nearby leftover cluster at the cheapest position", () => {
    const leftover = [{ clusterId: 99, lat: 37.505, lng: 127.01, seats: 3 }];
    const result = cheapestInsertion(leftover, [baseRoute], params);

    expect(result.unmerged.length).toBe(0);
    expect(result.merged.length).toBe(1);
    expect(result.merged[0].routeIndex).toBe(0);
  });

  it("leaves a far-away cluster unmerged when it exceeds max detour", () => {
    const leftover = [{ clusterId: 99, lat: 38.5, lng: 128.5, seats: 3 }];
    const result = cheapestInsertion(leftover, [baseRoute], params);

    expect(result.merged.length).toBe(0);
    expect(result.unmerged.length).toBe(1);
  });

  it("leaves a capacity-exceeding cluster unmerged even when geographically close", () => {
    const leftover = [{ clusterId: 99, lat: 37.505, lng: 127.01, seats: 30 }];
    const result = cheapestInsertion(leftover, [baseRoute], params);

    expect(result.merged.length).toBe(0);
    expect(result.unmerged.length).toBe(1);
  });
});
