import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, getEventById: vi.fn(), getRideRequestOriginsByEventId: vi.fn() };
});

import * as db from "./db";
import { appRouter } from "./routers";
import type { Event } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

function fakeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 1,
    title: "Test Event",
    category: "concert",
    eventDate: new Date("2026-08-01T10:00:00Z"),
    venue: "Test Venue",
    address: null,
    lat: "37.5",
    lng: "127.0",
    imageUrl: null,
    description: null,
    status: "active",
    creatorId: null,
    organizerName: null,
    autoMatchEnabled: true,
    autoMatchPricePerSeat: 20000,
    matchingFrozenAt: null,
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

describe("rideRequests.demandByEvent", () => {
  afterEach(() => {
    vi.mocked(db.getEventById).mockReset();
    vi.mocked(db.getRideRequestOriginsByEventId).mockReset();
  });

  it("returns aggregated grid cells for an auto-match event", async () => {
    vi.mocked(db.getEventById).mockResolvedValueOnce(fakeEvent());
    vi.mocked(db.getRideRequestOriginsByEventId).mockResolvedValueOnce([
      { originLat: "37.501", originLng: "127.041", seats: 1 },
      { originLat: "37.504", originLng: "127.044", seats: 2 },
    ]);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.rideRequests.demandByEvent({ eventId: 1 });

    expect(db.getRideRequestOriginsByEventId).toHaveBeenCalledWith(1, ["pending", "clustered"]);
    expect(result).toEqual([{ lat: 37.5, lng: 127.04, count: 2, seats: 3 }]);
  });

  it("returns an empty array when autoMatchEnabled is false, without querying origins", async () => {
    vi.mocked(db.getEventById).mockResolvedValueOnce(fakeEvent({ autoMatchEnabled: false }));

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.rideRequests.demandByEvent({ eventId: 1 });

    expect(result).toEqual([]);
    expect(db.getRideRequestOriginsByEventId).not.toHaveBeenCalled();
  });

  it("returns an empty array when the event doesn't exist", async () => {
    vi.mocked(db.getEventById).mockResolvedValueOnce(undefined);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.rideRequests.demandByEvent({ eventId: 999 });

    expect(result).toEqual([]);
  });
});
