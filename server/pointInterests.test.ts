import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getEventById: vi.fn(),
    getActiveRallyPointCandidates: vi.fn(),
    getBoardingPointsByEventId: vi.fn(),
    getPointInterestCounts: vi.fn(),
    getInterestedCandidateIds: vi.fn(),
    togglePointInterest: vi.fn(),
  };
});

import * as db from "./db";
import { appRouter } from "./routers";
import { filterUnservedCandidates } from "./pointInterests";
import type { BoardingPoint, RallyPointCandidate } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

function ctx(userId: number | null): TrpcContext {
  return {
    user: userId
      ? {
          id: userId, openId: `u-${userId}`, name: "T", email: null, loginMethod: "kakao", role: "user",
          status: "active", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
          referralCode: `C${userId}`, pointsBalance: 0,
        }
      : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

function candidate(id: number, lat: number, lng: number, o: Partial<RallyPointCandidate> = {}): RallyPointCandidate {
  return {
    id, name: `후보${id}`, region: "부산", lat: String(lat), lng: String(lng),
    busAccessible: true, notes: null, isActive: true, createdAt: new Date(), ...o,
  };
}

function stop(lat: number | null, lng: number | null): BoardingPoint {
  return {
    id: 1, tripId: 1, name: "정류장", address: null,
    lat: lat === null ? null : String(lat), lng: lng === null ? null : String(lng),
    pickupTime: null, order: 0, createdAt: new Date(), updatedAt: new Date(),
  };
}

afterEach(() => {
  Object.values(db).forEach((f) => { if (vi.isMockFunction(f)) f.mockReset(); });
});

describe("filterUnservedCandidates", () => {
  it("excludes candidates within the served radius of an existing stop", () => {
    // ~110m per 0.001 deg lat: c1 is ~110m from the stop (inside 300m), c2 is ~1.1km away.
    const c1 = candidate(1, 35.159, 129.06);
    const c2 = candidate(2, 35.169, 129.06);
    const result = filterUnservedCandidates([c1, c2], [stop(35.16, 129.06)]);
    expect(result.map((c) => c.id)).toEqual([2]);
  });

  it("keeps everything when the event has no boarding stops", () => {
    const cs = [candidate(1, 35.1, 129.0), candidate(2, 35.2, 129.1)];
    expect(filterUnservedCandidates(cs, [])).toHaveLength(2);
  });

  it("ignores stops without coordinates", () => {
    const cs = [candidate(1, 35.16, 129.06)];
    expect(filterUnservedCandidates(cs, [stop(null, null)])).toHaveLength(1);
  });
});

describe("pointInterests.byEvent", () => {
  it("returns candidates with counts and myInterested, excluding served ones", async () => {
    vi.mocked(db.getEventById).mockResolvedValue({ id: 5 } as any);
    vi.mocked(db.getActiveRallyPointCandidates).mockResolvedValue([
      candidate(1, 35.159, 129.06), // ~110m from stop → excluded
      candidate(2, 35.2, 129.1),
      candidate(3, 35.3, 129.2),
    ]);
    vi.mocked(db.getBoardingPointsByEventId).mockResolvedValue([stop(35.16, 129.06)]);
    vi.mocked(db.getPointInterestCounts).mockResolvedValue(new Map([[2, 7]]));
    vi.mocked(db.getInterestedCandidateIds).mockResolvedValue(new Set([2]));

    const caller = appRouter.createCaller(ctx(42));
    const result = await caller.pointInterests.byEvent({ eventId: 5 });

    expect(result).toEqual([
      { id: 2, name: "후보2", region: "부산", count: 7, myInterested: true },
      { id: 3, name: "후보3", region: "부산", count: 0, myInterested: false },
    ]);
  });

  it("anonymous viewers get myInterested=false without a per-user query", async () => {
    vi.mocked(db.getEventById).mockResolvedValue({ id: 5 } as any);
    vi.mocked(db.getActiveRallyPointCandidates).mockResolvedValue([candidate(2, 35.2, 129.1)]);
    vi.mocked(db.getBoardingPointsByEventId).mockResolvedValue([]);
    vi.mocked(db.getPointInterestCounts).mockResolvedValue(new Map());

    const caller = appRouter.createCaller(ctx(null));
    const result = await caller.pointInterests.byEvent({ eventId: 5 });

    expect(result[0].myInterested).toBe(false);
    expect(db.getInterestedCandidateIds).not.toHaveBeenCalled();
  });
});

describe("pointInterests.toggle", () => {
  it("toggles and returns {interested, count}", async () => {
    vi.mocked(db.getEventById).mockResolvedValue({ id: 5 } as any);
    vi.mocked(db.togglePointInterest).mockResolvedValue({ interested: true, count: 3 });

    const caller = appRouter.createCaller(ctx(42));
    const result = await caller.pointInterests.toggle({ eventId: 5, rallyPointCandidateId: 2 });

    expect(result).toEqual({ interested: true, count: 3 });
    expect(db.togglePointInterest).toHaveBeenCalledWith(5, 2, 42);
  });

  it("second toggle flips off (idempotent pair)", async () => {
    vi.mocked(db.getEventById).mockResolvedValue({ id: 5 } as any);
    vi.mocked(db.togglePointInterest).mockResolvedValue({ interested: false, count: 2 });

    const caller = appRouter.createCaller(ctx(42));
    const result = await caller.pointInterests.toggle({ eventId: 5, rallyPointCandidateId: 2 });
    expect(result).toEqual({ interested: false, count: 2 });
  });

  it("rejects an unauthenticated toggle", async () => {
    const caller = appRouter.createCaller(ctx(null));
    await expect(caller.pointInterests.toggle({ eventId: 5, rallyPointCandidateId: 2 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(db.togglePointInterest).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for a missing event", async () => {
    vi.mocked(db.getEventById).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(ctx(42));
    await expect(caller.pointInterests.toggle({ eventId: 999, rallyPointCandidateId: 2 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
