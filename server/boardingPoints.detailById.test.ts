import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getBoardingPointById: vi.fn(),
    getBoardingPointsByEventId: vi.fn(),
    getTripById: vi.fn(),
    getReservationsWithPaymentsByTripId: vi.fn(),
    getRideRequestOriginsByEventId: vi.fn(),
  };
});

import * as db from "./db";
import { appRouter } from "./routers";
import type { BoardingPoint, Trip } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

function fakeBoardingPoint(overrides: Partial<BoardingPoint> = {}): BoardingPoint {
  return {
    id: 1,
    tripId: 10,
    name: "Gangnam Station",
    address: "Gangnam-daero",
    lat: "37.4979000",
    lng: "127.0276000",
    pickupTime: new Date("2026-08-01T09:00:00Z"),
    order: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 10,
    eventId: 5,
    mode: "bus",
    status: "collecting",
    cancelReason: null,
    minCount: 15,
    maxCount: 45,
    currentCount: 12,
    price: 20000,
    departureAt: new Date("2026-08-01T08:30:00Z"),
    returnAt: null,
    isRoundTrip: false,
    operatorName: null,
    operatorContact: null,
    notes: null,
    creatorId: 1,
    sourceClusterId: null,
    theme: "standard",
    themeConfig: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

describe("boardingPoints.detailById", () => {
  afterEach(() => {
    vi.mocked(db.getBoardingPointById).mockReset();
    vi.mocked(db.getBoardingPointsByEventId).mockReset();
    vi.mocked(db.getTripById).mockReset();
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockReset();
    vi.mocked(db.getRideRequestOriginsByEventId).mockReset();
  });

  it("returns the point, co-located shuttle trips, and anonymous nearby demand", async () => {
    const point = fakeBoardingPoint({ id: 1, tripId: 10 });
    const samePoint = fakeBoardingPoint({
      id: 2,
      tripId: 11,
      pickupTime: new Date("2026-08-01T09:10:00Z"),
    });
    const otherPoint = fakeBoardingPoint({
      id: 3,
      tripId: 12,
      lat: "37.7000000",
      lng: "127.2000000",
    });
    const trip10 = fakeTrip({ id: 10, currentCount: 12, maxCount: 45 });
    const trip11 = fakeTrip({ id: 11, status: "confirmed", currentCount: 42, maxCount: 45 });

    vi.mocked(db.getBoardingPointById).mockResolvedValueOnce(point);
    vi.mocked(db.getTripById)
      .mockResolvedValueOnce(trip10)
      .mockResolvedValueOnce(trip10)
      .mockResolvedValueOnce(trip11);
    vi.mocked(db.getBoardingPointsByEventId).mockResolvedValueOnce([point, samePoint, otherPoint]);
    vi.mocked(db.getRideRequestOriginsByEventId).mockResolvedValueOnce([
      { originLat: "37.4980000", originLng: "127.0277000", seats: 1 },
      { originLat: "37.5050000", originLng: "127.0330000", seats: 2 },
      { originLat: "37.5400000", originLng: "127.0900000", seats: 4 },
    ]);
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([]);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.boardingPoints.detailById({ boardingPointId: 1 });

    expect(db.getRideRequestOriginsByEventId).toHaveBeenCalledWith(5, ["pending", "clustered"]);
    expect(result.point).toEqual(point);
    expect(result.nearbyDemand).toEqual({ count: 2, seats: 3 });
    expect(result.trips).toEqual([
      expect.objectContaining({
        id: 10,
        currentCount: 12,
        minCount: 15,
        maxCount: 45,
        availability: { remaining: 45 },
      }),
      expect.objectContaining({
        id: 11,
        status: "confirmed",
        pickupTime: samePoint.pickupTime,
        availability: { remaining: 45 },
      }),
    ]);

    expect(JSON.stringify(result)).not.toContain("userId");
    expect(JSON.stringify(result)).not.toContain("passengerName");
    expect(JSON.stringify(result)).not.toContain("passengerPhone");
    expect(JSON.stringify(result)).not.toContain("originAddress");
  });

  it("returns not found when the boarding point does not exist", async () => {
    vi.mocked(db.getBoardingPointById).mockResolvedValueOnce(undefined);

    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.boardingPoints.detailById({ boardingPointId: 999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
