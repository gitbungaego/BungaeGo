import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, getBoardingPointsByEventId: vi.fn() };
});

import * as db from "./db";
import { appRouter } from "./routers";
import type { BoardingPoint } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

function fakeBoardingPoint(overrides: Partial<BoardingPoint>): BoardingPoint {
  return {
    id: 1,
    tripId: 1,
    name: "강남역",
    address: null,
    lat: "37.4979",
    lng: "127.0276",
    pickupTime: null,
    order: 0,
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

describe("boardingPoints.byEventId", () => {
  afterEach(() => {
    vi.mocked(db.getBoardingPointsByEventId).mockReset();
  });

  it("returns every trip's boarding points for the event, unauthenticated", async () => {
    const points = [
      fakeBoardingPoint({ id: 1, tripId: 10, name: "강남역" }),
      fakeBoardingPoint({ id: 2, tripId: 11, name: "잠실역" }),
    ];
    vi.mocked(db.getBoardingPointsByEventId).mockResolvedValueOnce(points);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.boardingPoints.byEventId({ eventId: 5 });

    expect(db.getBoardingPointsByEventId).toHaveBeenCalledWith(5);
    expect(result).toEqual(points);
  });

  it("returns an empty array when the event has no boarding points", async () => {
    vi.mocked(db.getBoardingPointsByEventId).mockResolvedValueOnce([]);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.boardingPoints.byEventId({ eventId: 999 });

    expect(result).toEqual([]);
  });
});
