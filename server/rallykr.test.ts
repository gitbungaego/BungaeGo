import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

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
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      referralCode: "USER0001",
      pointsBalance: 5000,
    },
  });
}

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
