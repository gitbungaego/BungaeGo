import { afterEach, describe, expect, it } from "vitest";
import { appRouter, validatePointsUsage } from "./routers";
import { buildFareItems } from "./payments";
import { getPolicy, StandardPolicy } from "./matching/confirmPolicy";
import { filterParticipants } from "./participants";
import { buildTripMessage } from "./notify/tripMessenger";
import { getSessionCookieOptions } from "./_core/cookies";
import { hasConsent, isConsentCurrent } from "./consents";
import { isEnabled, isThemeAllowed } from "./featureFlags";
import type { ReservationWithPayment } from "./db";
import type { PaymentItem, Trip } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import type { Request } from "express";

function fakeReservation(overrides: Partial<ReservationWithPayment>): ReservationWithPayment {
  return {
    id: 1,
    userId: 1,
    tripId: 1,
    boardingPointId: null,
    seats: 1,
    seatNo: null,
    pointsUsed: 0,
    passengerName: null,
    passengerPhone: null,
    passengerEmail: null,
    qrToken: null,
    referralCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    status: "paid",
    totalAmount: 0,
    paymentMethod: "mock",
    chargeType: "prepaid",
    paidAt: new Date(),
    cancelledAt: null,
    cancelReason: null,
    cancelNote: null,
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<TrpcContext>): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
    ...overrides,
  };
}

function makeAdminCtx(): TrpcContext {
  return makeCtx({
    user: {
      id: 1,
      openId: "admin-open-id",
      name: "Admin",
      email: "admin@bungae_go.com",
      loginMethod: "manus",
      role: "admin",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      referralCode: "ADMIN001",
      pointsBalance: 0,
    },
  });
}

function makeUserCtx(): TrpcContext {
  return makeCtx({
    user: {
      id: 2,
      openId: "user-open-id",
      name: "Test User",
      email: "user@test.com",
      loginMethod: "manus",
      role: "user",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      referralCode: "USER0001",
      pointsBalance: 5000,
    },
  });
}

describe("getSessionCookieOptions", () => {
  const originalCrossSiteCookies = process.env.CROSS_SITE_COOKIES;

  afterEach(() => {
    if (originalCrossSiteCookies === undefined) {
      delete process.env.CROSS_SITE_COOKIES;
    } else {
      process.env.CROSS_SITE_COOKIES = originalCrossSiteCookies;
    }
  });

  it("defaults to sameSite=lax over https", () => {
    delete process.env.CROSS_SITE_COOKIES;
    const req = { protocol: "https", headers: {} } as Request;
    expect(getSessionCookieOptions(req)).toMatchObject({ sameSite: "lax", secure: true });
  });

  it("defaults to sameSite=lax, secure=false over http", () => {
    delete process.env.CROSS_SITE_COOKIES;
    const req = { protocol: "http", headers: {} } as Request;
    expect(getSessionCookieOptions(req)).toMatchObject({ sameSite: "lax", secure: false });
  });

  it("switches to sameSite=none + secure when CROSS_SITE_COOKIES=true", () => {
    process.env.CROSS_SITE_COOKIES = "true";
    const req = { protocol: "http", headers: {} } as Request;
    expect(getSessionCookieOptions(req)).toMatchObject({ sameSite: "none", secure: true });
  });
});

describe("auth", () => {
  it("me returns null for unauthenticated user", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("logout clears session cookie", async () => {
    const cleared: string[] = [];
    const ctx = makeCtx({
      res: {
        clearCookie: (name: string) => cleared.push(name),
      } as TrpcContext["res"],
    });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
    expect(cleared.length).toBe(1);
  });
});

describe("events", () => {
  it("list returns array", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.events.list({});
    expect(Array.isArray(result)).toBe(true);
  });

  it("byId throws NOT_FOUND for non-existent event", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.events.byId({ id: 999999 })).rejects.toThrow();
  });

  it("adminList requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(caller.events.adminList()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("adminList succeeds for admin", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.events.adminList();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("trips", () => {
  it("byEventId returns array", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.trips.byEventId({ eventId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("byId throws NOT_FOUND for non-existent trip", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.trips.byId({ id: 999999 })).rejects.toThrow();
  });

  it("create rejects a non-standard theme when FEATURE_THEMES is off", async () => {
    delete process.env.FEATURE_THEMES;
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.trips.create({
        eventId: 1,
        minCount: 10,
        maxCount: 40,
        price: 10000,
        departureAt: Date.now(),
        theme: "festival",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("create does not block a non-standard theme when FEATURE_THEMES is on", async () => {
    process.env.FEATURE_THEMES = "true";
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.trips.create({
        eventId: 1,
        minCount: 10,
        maxCount: 40,
        price: 10000,
        departureAt: Date.now(),
        theme: "festival",
      })
    ).rejects.not.toMatchObject({ code: "FORBIDDEN" });
    delete process.env.FEATURE_THEMES;
  });

  it("create rejects minCount greater than maxCount", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.trips.create({
        eventId: 1,
        minCount: 50,
        maxCount: 40,
        price: 10000,
        departureAt: Date.now(),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("create accepts minCount equal to maxCount", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.trips.create({
        eventId: 1,
        minCount: 40,
        maxCount: 40,
        price: 10000,
        departureAt: Date.now(),
      })
    ).rejects.not.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("create rejects a price above the per-seat cap", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.trips.create({
        eventId: 1,
        minCount: 10,
        maxCount: 40,
        price: 2_000_000,
        departureAt: Date.now(),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("create accepts a reasonable price under the cap", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.trips.create({
        eventId: 1,
        minCount: 10,
        maxCount: 40,
        price: 25000,
        departureAt: Date.now(),
      })
    ).rejects.not.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("boardingPoints", () => {
  it("byTripId returns array", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.boardingPoints.byTripId({ tripId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("reservations", () => {
  it("myList requires authentication", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.reservations.myList()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("myList returns array for authenticated user", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    const result = await caller.reservations.myList();
    expect(Array.isArray(result)).toBe(true);
  });

  it("create rejects suspended users", async () => {
    const ctx = makeUserCtx();
    ctx.user = { ...ctx.user!, status: "suspended" };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.reservations.create({
        tripId: 1,
        seats: 1,
        passengerName: "정지테스터",
        passengerPhone: "010-0000-0000",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("points", () => {
  it("myBalance requires authentication", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.points.myBalance()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("myBalance returns balance for authenticated user", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    const result = await caller.points.myBalance();
    expect(typeof result.balance).toBe("number");
  });
});

describe("referrals", () => {
  it("myCode requires authentication", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.referrals.myCode()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("payments", () => {
  it("buildFareItems: item sum equals total when no points used", () => {
    const items = buildFareItems({ fareAmount: 30000, pointsUsed: 0 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "fare", amount: 30000 });
    const sum = items.reduce((s, i) => s + i.amount, 0);
    expect(sum).toBe(30000);
  });

  it("buildFareItems: item sum equals fareAmount - pointsUsed when points used", () => {
    const items = buildFareItems({ fareAmount: 30000, pointsUsed: 5000 });
    expect(items).toHaveLength(2);
    const sum = items.reduce((s, i) => s + i.amount, 0);
    expect(sum).toBe(30000 - 5000);
    expect(items.find((i) => i.type === "discount")).toMatchObject({ amount: -5000 });
  });

  // computeRefundableAmount's tiered cancellation fee behavior (including the
  // trip_not_confirmed bypass) is covered in server/payments.test.ts, which
  // exercises it against real departureAt/reservationCreatedAt timing.
});

describe("confirmPolicy", () => {
  it("getPolicy: 'standard' resolves to StandardPolicy, unknown theme throws", () => {
    expect(getPolicy("standard")).toBe(StandardPolicy);
    expect(() => getPolicy("vip")).toThrow();
  });

  it("StandardPolicy.canConfirm: false while active seats are below minCount", () => {
    const trip = { id: 1, status: "collecting", minCount: 15, maxCount: 45 } as Trip;
    const reservations = [fakeReservation({ seats: 10 })];
    expect(StandardPolicy.canConfirm(trip, reservations)).toBe(false);
  });

  it("StandardPolicy.canConfirm: true once active seats reach minCount while collecting", () => {
    const trip = { id: 1, status: "collecting", minCount: 15, maxCount: 45 } as Trip;
    const reservations = [fakeReservation({ seats: 10 }), fakeReservation({ id: 2, seats: 5 })];
    expect(StandardPolicy.canConfirm(trip, reservations)).toBe(true);
  });

  it("StandardPolicy.canConfirm: false when trip is no longer collecting (already confirmed/cancelled)", () => {
    const trip = { id: 1, status: "confirmed", minCount: 15, maxCount: 45 } as Trip;
    const reservations = [fakeReservation({ seats: 20 })];
    expect(StandardPolicy.canConfirm(trip, reservations)).toBe(false);
  });

  it("StandardPolicy.canConfirm: cancelled reservations don't count toward minCount", () => {
    const trip = { id: 1, status: "collecting", minCount: 15, maxCount: 45 } as Trip;
    const reservations = [
      fakeReservation({ seats: 10, status: "cancelled" }),
      fakeReservation({ id: 2, seats: 10 }),
    ];
    expect(StandardPolicy.canConfirm(trip, reservations)).toBe(false);
  });

  it("StandardPolicy.availability: remaining excludes cancelled reservations", () => {
    const trip = { id: 1, status: "collecting", minCount: 15, maxCount: 45 } as Trip;
    const reservations = [
      fakeReservation({ seats: 10 }),
      fakeReservation({ id: 2, seats: 5, status: "cancelled" }),
    ];
    expect(StandardPolicy.availability(trip, reservations)).toEqual({ total: 45, remaining: 35 });
  });

  it("StandardPolicy.canReserve: rejects a cancelled trip, allows otherwise", () => {
    const cancelledTrip = { id: 1, status: "cancelled" } as Trip;
    const collectingTrip = { id: 1, status: "collecting" } as Trip;
    expect(StandardPolicy.canReserve(cancelledTrip, [], {} as any)).toMatchObject({ ok: false });
    expect(StandardPolicy.canReserve(collectingTrip, [], {} as any)).toEqual({ ok: true });
  });
});

describe("participants", () => {
  it("filterParticipants: 'all' returns only paid reservations, excluding pending/cancelled", () => {
    const reservations = [
      fakeReservation({ id: 1, userId: 10, status: "paid" }),
      fakeReservation({ id: 2, userId: 11, status: "cancelled" }),
      fakeReservation({ id: 3, userId: 12, status: "pending" }),
    ];
    const result = filterParticipants(reservations, "all");
    expect(result.map((p) => p.userId)).toEqual([10]);
  });

  it("filterParticipants: userId[] narrows to the given users among paid reservations", () => {
    const reservations = [
      fakeReservation({ id: 1, userId: 10, status: "paid" }),
      fakeReservation({ id: 2, userId: 11, status: "paid" }),
      fakeReservation({ id: 3, userId: 12, status: "paid" }),
    ];
    const result = filterParticipants(reservations, [11, 12]);
    expect(result.map((p) => p.userId).sort()).toEqual([11, 12]);
  });

  it("filterParticipants: 'checkedIn'/'notCheckedIn' throw (no check-in tracking exists yet)", () => {
    expect(() => filterParticipants([], "checkedIn")).toThrow();
    expect(() => filterParticipants([], "notCheckedIn")).toThrow();
  });
});

describe("tripMessenger", () => {
  it("buildTripMessage: reservationConfirmed includes passenger name and seat count", () => {
    const message = buildTripMessage("reservationConfirmed", {
      passengerName: "홍길동",
      seats: 2,
      departureAt: new Date("2026-08-01T09:00:00+09:00"),
    });
    expect(message.title).toBeTruthy();
    expect(message.body).toContain("홍길동");
    expect(message.body).toContain("2석");
  });

  it("buildTripMessage: tripConfirmed includes the event title", () => {
    const message = buildTripMessage("tripConfirmed", {
      eventTitle: "아이유 콘서트",
      departureAt: new Date("2026-08-01T09:00:00+09:00"),
    });
    expect(message.body).toContain("아이유 콘서트");
  });

  it("buildTripMessage: departureReminder includes the boarding point when given", () => {
    const withStop = buildTripMessage("departureReminder", {
      departureAt: new Date(),
      boardingPointName: "강남역",
    });
    const withoutStop = buildTripMessage("departureReminder", { departureAt: new Date() });
    expect(withStop.body).toContain("강남역");
    expect(withoutStop.body).not.toContain("강남역");
  });
});

describe("consents", () => {
  it("isConsentCurrent is false when no consent exists yet", () => {
    expect(isConsentCurrent(undefined, "2026-01-01")).toBe(false);
  });

  it("isConsentCurrent is false when the latest consent is an older version", () => {
    const outdated = { id: 1, userId: 1, type: "tos", version: "2025-01-01", agreedAt: new Date() };
    expect(isConsentCurrent(outdated, "2026-01-01")).toBe(false);
  });

  it("isConsentCurrent is true when the latest consent matches the current version", () => {
    const current = { id: 1, userId: 1, type: "tos", version: "2026-01-01", agreedAt: new Date() };
    expect(isConsentCurrent(current, "2026-01-01")).toBe(true);
  });

  it("hasConsent rejects an unregistered consent type", async () => {
    await expect(hasConsent(1, "not-a-real-type")).rejects.toThrow();
  });
});

describe("featureFlags", () => {
  const originalFeatureThemes = process.env.FEATURE_THEMES;

  afterEach(() => {
    if (originalFeatureThemes === undefined) {
      delete process.env.FEATURE_THEMES;
    } else {
      process.env.FEATURE_THEMES = originalFeatureThemes;
    }
  });

  it("isEnabled is off by default", () => {
    delete process.env.FEATURE_THEMES;
    expect(isEnabled("themes")).toBe(false);
  });

  it("isEnabled turns on only for the literal string 'true'", () => {
    process.env.FEATURE_THEMES = "true";
    expect(isEnabled("themes")).toBe(true);
    process.env.FEATURE_THEMES = "1";
    expect(isEnabled("themes")).toBe(false);
  });

  it("isThemeAllowed always allows the standard theme", () => {
    delete process.env.FEATURE_THEMES;
    expect(isThemeAllowed("standard")).toBe(true);
  });

  it("isThemeAllowed gates non-standard themes behind FEATURE_THEMES", () => {
    delete process.env.FEATURE_THEMES;
    expect(isThemeAllowed("festival")).toBe(false);
    process.env.FEATURE_THEMES = "true";
    expect(isThemeAllowed("festival")).toBe(true);
  });
});

describe("admin", () => {
  it("stats requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(caller.admin.stats()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("stats returns stats for admin", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.admin.stats();
    expect(typeof result.totalEvents).toBe("number");
    expect(typeof result.totalRevenue).toBe("number");
  });
});

describe("validatePointsUsage", () => {
  it("passes when pointsUsed is within both balance and fare amount", () => {
    expect(() => validatePointsUsage(5000, 10000, 20000)).not.toThrow();
  });

  it("throws when pointsUsed exceeds the user's balance", () => {
    expect(() => validatePointsUsage(5000, 1000, 20000)).toThrow();
  });

  it("throws when pointsUsed exceeds the fare amount, even with enough balance", () => {
    expect(() => validatePointsUsage(15000, 100000, 10000)).toThrow();
  });

  it("allows pointsUsed exactly equal to balance or fare amount", () => {
    expect(() => validatePointsUsage(10000, 10000, 10000)).not.toThrow();
  });
});
