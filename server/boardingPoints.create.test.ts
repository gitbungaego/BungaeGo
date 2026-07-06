import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, getTripById: vi.fn(), createBoardingPoint: vi.fn() };
});

import * as db from "./db";
import { appRouter } from "./routers";
import type { Trip } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

function fakeTrip(overrides: Partial<Trip>): Trip {
  return {
    id: 1,
    eventId: 1,
    mode: "bus",
    status: "collecting",
    minCount: 15,
    maxCount: 45,
    currentCount: 0,
    price: 25000,
    departureAt: new Date("2026-08-01T09:00:00Z"),
    returnAt: null,
    isRoundTrip: false,
    operatorName: null,
    operatorContact: null,
    notes: null,
    creatorId: null,
    sourceClusterId: null,
    theme: "standard",
    themeConfig: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeUserCtx(userId: number, role: "user" | "admin" = "user"): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      name: "Test User",
      email: "user@test.com",
      loginMethod: "manus",
      role,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      referralCode: `CODE${userId}`,
      pointsBalance: 0,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

describe("boardingPoints.create ownership", () => {
  afterEach(() => {
    vi.mocked(db.getTripById).mockReset();
    vi.mocked(db.createBoardingPoint).mockReset();
  });

  it("allows the trip's own creator to add a boarding point", async () => {
    vi.mocked(db.getTripById).mockResolvedValueOnce(fakeTrip({ creatorId: 42 }));
    vi.mocked(db.createBoardingPoint).mockResolvedValueOnce(1001);

    const caller = appRouter.createCaller(makeUserCtx(42));
    const result = await caller.boardingPoints.create({ tripId: 1, name: "강남역" });

    expect(result).toEqual({ id: 1001 });
  });

  it("rejects a user who does not own the trip", async () => {
    vi.mocked(db.getTripById).mockResolvedValueOnce(fakeTrip({ creatorId: 42 }));

    const caller = appRouter.createCaller(makeUserCtx(99));
    await expect(
      caller.boardingPoints.create({ tripId: 1, name: "강남역" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.createBoardingPoint).not.toHaveBeenCalled();
  });

  it("allows an admin to add a boarding point regardless of trip ownership", async () => {
    vi.mocked(db.getTripById).mockResolvedValueOnce(fakeTrip({ creatorId: 42 }));
    vi.mocked(db.createBoardingPoint).mockResolvedValueOnce(1002);

    const caller = appRouter.createCaller(makeUserCtx(99, "admin"));
    const result = await caller.boardingPoints.create({ tripId: 1, name: "강남역" });

    expect(result).toEqual({ id: 1002 });
  });

  it("throws NOT_FOUND when the trip does not exist", async () => {
    vi.mocked(db.getTripById).mockResolvedValueOnce(undefined);

    const caller = appRouter.createCaller(makeUserCtx(42));
    await expect(
      caller.boardingPoints.create({ tripId: 999999, name: "강남역" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
