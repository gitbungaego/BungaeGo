import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getEventById: vi.fn(),
    toggleEventLike: vi.fn(),
  };
});

import * as db from "./db";
import { appRouter } from "./routers";
import type { Event } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

function fakeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 5,
    title: "Test Event",
    category: "concert",
    eventDate: new Date("2026-08-20T11:00:00.000Z"),
    venue: "Venue",
    address: null,
    lat: null,
    lng: null,
    imageUrl: null,
    description: null,
    status: "active",
    creatorId: null,
    organizerName: null,
    autoMatchEnabled: false,
    autoMatchPricePerSeat: null,
    matchingFrozenAt: null,
    matchingFrozenBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function userCtx(userId: number | null): TrpcContext {
  return {
    user: userId
      ? {
          id: userId,
          openId: `user-${userId}`,
          name: "T",
          email: "t@test.com",
          loginMethod: "manus",
          role: "user",
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
          lastSignedIn: new Date(),
          referralCode: `C${userId}`,
          pointsBalance: 0,
        }
      : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

afterEach(() => {
  vi.mocked(db.getEventById).mockReset();
  vi.mocked(db.toggleEventLike).mockReset();
});

describe("events.toggleLike", () => {
  it("likes an event when not yet liked (returns liked=true + count)", async () => {
    vi.mocked(db.getEventById).mockResolvedValue(fakeEvent());
    vi.mocked(db.toggleEventLike).mockResolvedValue({ liked: true, count: 1 });

    const caller = appRouter.createCaller(userCtx(42));
    const result = await caller.events.toggleLike({ eventId: 5 });

    expect(result).toEqual({ liked: true, count: 1 });
    expect(db.toggleEventLike).toHaveBeenCalledWith(5, 42);
  });

  it("unlikes on the second toggle (idempotent flip)", async () => {
    vi.mocked(db.getEventById).mockResolvedValue(fakeEvent());
    vi.mocked(db.toggleEventLike).mockResolvedValue({ liked: false, count: 0 });

    const caller = appRouter.createCaller(userCtx(42));
    const result = await caller.events.toggleLike({ eventId: 5 });

    expect(result).toEqual({ liked: false, count: 0 });
  });

  it("rejects an unauthenticated toggle", async () => {
    const caller = appRouter.createCaller(userCtx(null));
    await expect(caller.events.toggleLike({ eventId: 5 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(db.toggleEventLike).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for a missing event", async () => {
    vi.mocked(db.getEventById).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(userCtx(42));
    await expect(caller.events.toggleLike({ eventId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.toggleEventLike).not.toHaveBeenCalled();
  });
});

describe("events.list / byId - like fields", () => {
  it("list includes likeCount and myLiked", async () => {
    vi.spyOn(db, "getEvents").mockResolvedValue([fakeEvent({ id: 5 }), fakeEvent({ id: 6 })]);
    vi.spyOn(db, "getEventLikeCounts").mockResolvedValue(new Map([[5, 3]]));
    vi.spyOn(db, "getLikedEventIds").mockResolvedValue(new Set([5]));

    const caller = appRouter.createCaller(userCtx(42));
    const result = await caller.events.list({});

    expect(result[0]).toMatchObject({ id: 5, likeCount: 3, myLiked: true });
    expect(result[1]).toMatchObject({ id: 6, likeCount: 0, myLiked: false });
  });

  it("byId reports myLiked=false for an anonymous viewer without querying likes-by-user", async () => {
    vi.spyOn(db, "getEventById").mockResolvedValue(fakeEvent({ id: 5 }));
    vi.spyOn(db, "getEventLikeCount").mockResolvedValue(7);
    const likedSpy = vi.spyOn(db, "getLikedEventIds");

    const caller = appRouter.createCaller(userCtx(null));
    const result = await caller.events.byId({ id: 5 });

    expect(result).toMatchObject({ id: 5, likeCount: 7, myLiked: false });
    expect(likedSpy).not.toHaveBeenCalled();
  });
});
