import { describe, expect, it } from "vitest";
import {
  binPackByCapacity,
  buildRoutes,
  nearestNeighborTour,
  twoOptImprove,
  type StopDemand,
} from "./routeBuilder";
import { haversineMeters } from "./haversine";

describe("binPackByCapacity", () => {
  it("places demands under one bus's capacity into a single bin", () => {
    const demands = [{ seats: 10 }, { seats: 15 }, { seats: 5 }];
    const { bins } = binPackByCapacity(demands, 45);
    expect(bins.length).toBe(1);
  });

  it("splits demands requiring two buses into two bins, neither exceeding capacity", () => {
    const demands = [{ seats: 30 }, { seats: 30 }, { seats: 10 }];
    const { bins } = binPackByCapacity(demands, 45);
    expect(bins.length).toBe(2);
    for (const bin of bins) {
      const total = bin.reduce((sum, d) => sum + d.seats, 0);
      expect(total).toBeLessThanOrEqual(45);
    }
  });

  it("reports a single demand exceeding capacity as oversized instead of packing it into an invalid bin", () => {
    const demands = [{ seats: 10 }, { seats: 60 }, { seats: 5 }];
    const { bins, oversized } = binPackByCapacity(demands, 45);

    expect(oversized).toEqual([{ seats: 60 }]);
    for (const bin of bins) {
      const total = bin.reduce((sum, d) => sum + d.seats, 0);
      expect(total).toBeLessThanOrEqual(45);
    }
  });
});

describe("twoOptImprove", () => {
  it("never produces a worse tour than the input", () => {
    const venue = { lat: 37.5, lng: 127.0 };
    const stops = [
      { lat: 37.51, lng: 127.02 },
      { lat: 37.55, lng: 126.95 },
      { lat: 37.48, lng: 127.1 },
      { lat: 37.6, lng: 127.05 },
    ];
    const initial = nearestNeighborTour(stops, venue);
    const improved = twoOptImprove(initial, venue);

    const distanceOf = (tour: typeof stops) => {
      let total = 0;
      for (let i = 0; i < tour.length - 1; i++) total += haversineMeters(tour[i], tour[i + 1]);
      total += haversineMeters(tour[tour.length - 1], venue);
      return total;
    };

    expect(distanceOf(improved)).toBeLessThanOrEqual(distanceOf(initial) + 1e-6);
  });
});

describe("buildRoutes", () => {
  const params = {
    maxCapacitySeats: 45,
    minCapacitySeats: 15,
    avgSpeedKmh: 30,
    stopDwellMinutes: 3,
    venueLat: 37.5,
    venueLng: 127.0,
  };

  it("never exceeds max capacity per route", () => {
    const targetArrivalAt = new Date("2026-08-01T18:00:00Z");
    const demands: StopDemand[] = Array.from({ length: 5 }, (_, i) => ({
      clusterId: i,
      lat: 37.5 + i * 0.05,
      lng: 127.0 + i * 0.05,
      seats: 12,
      targetArrivalAt,
    }));
    const { routes } = buildRoutes(demands, params);
    for (const route of routes) {
      expect(route.totalSeats).toBeLessThanOrEqual(params.maxCapacitySeats);
    }
  });

  it("computes pickup times that decrease monotonically walking backward and land near the deadline", () => {
    const targetArrivalAt = new Date("2026-08-01T18:00:00Z");
    const demands: StopDemand[] = [
      { clusterId: 1, lat: 37.55, lng: 127.05, seats: 10, targetArrivalAt },
      { clusterId: 2, lat: 37.52, lng: 127.02, seats: 10, targetArrivalAt },
      { clusterId: 3, lat: 37.6, lng: 127.1, seats: 10, targetArrivalAt },
    ];
    const { routes } = buildRoutes(demands, params);
    expect(routes.length).toBe(1);
    const stops = routes[0].stops;

    for (let i = 0; i < stops.length - 1; i++) {
      expect(stops[i].pickupTime.getTime()).toBeLessThan(stops[i + 1].pickupTime.getTime());
    }

    const lastStop = stops[stops.length - 1];
    const travelToVenueMs =
      (haversineMeters(lastStop, { lat: params.venueLat, lng: params.venueLng }) / 1000 / params.avgSpeedKmh) *
      3600000;
    const expectedArrival = lastStop.pickupTime.getTime() + travelToVenueMs + params.stopDwellMinutes * 60000;
    expect(Math.abs(expectedArrival - targetArrivalAt.getTime())).toBeLessThan(1000);
  });

  it("reports a demand exceeding maxCapacitySeats as oversized instead of building an over-capacity route for it", () => {
    const targetArrivalAt = new Date("2026-08-01T18:00:00Z");
    const demands: StopDemand[] = [
      { clusterId: 1, lat: 37.55, lng: 127.05, seats: 10, targetArrivalAt },
      { clusterId: 2, lat: 37.52, lng: 127.02, seats: 60, targetArrivalAt },
    ];
    const { routes, oversizedDemands } = buildRoutes(demands, params);

    expect(oversizedDemands.map((d) => d.clusterId)).toEqual([2]);
    for (const route of routes) {
      expect(route.totalSeats).toBeLessThanOrEqual(params.maxCapacitySeats);
    }
  });
});
