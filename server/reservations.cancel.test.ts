import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getReservationById: vi.fn(),
    getTripById: vi.fn(),
    getLatestPaymentByReservationId: vi.fn(),
    getPaymentItemsByPaymentId: vi.fn(),
    updatePaymentStatus: vi.fn(),
    decrementTripCount: vi.fn(),
    addPoints: vi.fn(),
    getReferralByReservationId: vi.fn(),
    updateReferralStatus: vi.fn(),
  };
});

import * as db from "./db";
import { appRouter } from "./routers";
import type { PaymentItem, Trip } from "../drizzle/schema";
import type { ReservationWithPayment } from "./db";
import type { TrpcContext } from "./_core/context";
import { dMinusBoundaryUtc } from "@shared/cancellationPolicy";

// departureAt = 2026-08-20 20:00 KST = 2026-08-20 11:00 UTC.
const DEPARTURE_AT = new Date("2026-08-20T11:00:00.000Z");
const D6_START = dMinusBoundaryUtc(DEPARTURE_AT, 6); // 50% fee tier starts here
const D4_INSTANT = new Date(dMinusBoundaryUtc(DEPARTURE_AT, 4).getTime() + 60 * 60 * 1000); // well inside D-4, forbidden

function fakeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 1,
    eventId: 1,
    mode: "bus",
    status: "confirmed",
    cancelReason: null,
    minCount: 15,
    maxCount: 45,
    currentCount: 15,
    price: 30000,
    departureAt: DEPARTURE_AT,
    returnAt: null,
    isRoundTrip: false,
    operatorName: null,
    operatorContact: null,
    notes: null,
    creatorId: null,
    sourceClusterId: null,
    theme: "standard",
    themeConfig: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

function fakeReservation(overrides: Partial<ReservationWithPayment> = {}): ReservationWithPayment {
  return {
    id: 1,
    userId: 42,
    tripId: 1,
    boardingPointId: null,
    seats: 1,
    seatNo: null,
    pointsUsed: 0,
    passengerName: "Test",
    passengerPhone: "010-0000-0000",
    passengerEmail: null,
    qrToken: null,
    referralCode: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"), // outside the 1hr grace unless overridden
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    status: "paid",
    totalAmount: 30000,
    paymentMethod: "mock",
    chargeType: "prepaid",
    paidAt: new Date("2026-06-01T00:00:00.000Z"),
    cancelledAt: null,
    cancelReason: null,
    cancelNote: null,
    ...overrides,
  };
}

function fakeFareItem(): PaymentItem {
  return {
    id: 1,
    paymentId: 1,
    type: "fare",
    amount: 30000,
    label: "셔틀 요금",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
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

describe("reservations.cancel - tiered fee policy", () => {
  afterEach(() => {
    vi.mocked(db.getReservationById).mockReset();
    vi.mocked(db.getTripById).mockReset();
    vi.mocked(db.getLatestPaymentByReservationId).mockReset();
    vi.mocked(db.getPaymentItemsByPaymentId).mockReset();
    vi.mocked(db.updatePaymentStatus).mockReset();
    vi.mocked(db.decrementTripCount).mockReset();
    vi.mocked(db.addPoints).mockReset();
    vi.mocked(db.getReferralByReservationId).mockReset();
    vi.mocked(db.updateReferralStatus).mockReset();
    vi.useRealTimers();
  });

  it("(c) applies a 50% fee at D-6 and records the reduced refund in cancelNote", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(D6_START);

    vi.mocked(db.getReservationById).mockResolvedValueOnce(fakeReservation());
    vi.mocked(db.getTripById).mockResolvedValueOnce(fakeTrip());
    vi.mocked(db.getLatestPaymentByReservationId).mockResolvedValueOnce({ id: 1 } as any);
    vi.mocked(db.getPaymentItemsByPaymentId).mockResolvedValueOnce([fakeFareItem()]);
    vi.mocked(db.getReferralByReservationId).mockResolvedValueOnce(undefined);

    const caller = appRouter.createCaller(makeUserCtx(42));
    const result = await caller.reservations.cancel({ id: 1 });

    expect(result).toEqual({ success: true });
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(
      1,
      "cancelled",
      expect.objectContaining({ cancelReason: "user_request", cancelNote: expect.stringContaining("15000") })
    );
  });

  it("(d) rejects cancellation at D-4 with BAD_REQUEST and makes no state changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(D4_INSTANT);

    vi.mocked(db.getReservationById).mockResolvedValueOnce(fakeReservation());
    vi.mocked(db.getTripById).mockResolvedValueOnce(fakeTrip());

    const caller = appRouter.createCaller(makeUserCtx(42));
    await expect(caller.reservations.cancel({ id: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(db.updatePaymentStatus).not.toHaveBeenCalled();
    expect(db.decrementTripCount).not.toHaveBeenCalled();
    expect(db.addPoints).not.toHaveBeenCalled();
  });

  it("(e) refunds in full within the 1hr creation grace, even though D-4 would normally forbid it", async () => {
    const reservedAt = new Date(D4_INSTANT.getTime() - 30 * 60 * 1000); // 30 min before "now"
    vi.useFakeTimers();
    vi.setSystemTime(D4_INSTANT);

    vi.mocked(db.getReservationById).mockResolvedValueOnce(fakeReservation({ createdAt: reservedAt }));
    vi.mocked(db.getTripById).mockResolvedValueOnce(fakeTrip());
    vi.mocked(db.getLatestPaymentByReservationId).mockResolvedValueOnce({ id: 1 } as any);
    vi.mocked(db.getPaymentItemsByPaymentId).mockResolvedValueOnce([fakeFareItem()]);
    vi.mocked(db.getReferralByReservationId).mockResolvedValueOnce(undefined);

    const caller = appRouter.createCaller(makeUserCtx(42));
    const result = await caller.reservations.cancel({ id: 1 });

    expect(result).toEqual({ success: true });
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(
      1,
      "cancelled",
      expect.objectContaining({ cancelNote: expect.stringContaining("30000") })
    );
  });
});

describe("reservations.adminCancel - bypasses the D-5 restriction", () => {
  afterEach(() => {
    vi.mocked(db.getReservationById).mockReset();
    vi.mocked(db.getTripById).mockReset();
    vi.mocked(db.getLatestPaymentByReservationId).mockReset();
    vi.mocked(db.getPaymentItemsByPaymentId).mockReset();
    vi.mocked(db.updatePaymentStatus).mockReset();
    vi.mocked(db.decrementTripCount).mockReset();
    vi.mocked(db.addPoints).mockReset();
    vi.mocked(db.getReferralByReservationId).mockReset();
    vi.mocked(db.updateReferralStatus).mockReset();
    vi.useRealTimers();
  });

  it("rejects a non-admin user with FORBIDDEN", async () => {
    const caller = appRouter.createCaller(makeUserCtx(42, "user"));
    await expect(caller.reservations.adminCancel({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.getReservationById).not.toHaveBeenCalled();
  });

  it("lets an admin cancel with full refund at D-4, where the normal cancel would be rejected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(D4_INSTANT);

    vi.mocked(db.getReservationById).mockResolvedValueOnce(fakeReservation());
    vi.mocked(db.getTripById).mockResolvedValueOnce(fakeTrip());
    vi.mocked(db.getLatestPaymentByReservationId).mockResolvedValueOnce({ id: 1 } as any);
    vi.mocked(db.getPaymentItemsByPaymentId).mockResolvedValueOnce([fakeFareItem()]);
    vi.mocked(db.getReferralByReservationId).mockResolvedValueOnce(undefined);

    const caller = appRouter.createCaller(makeUserCtx(7, "admin"));
    const result = await caller.reservations.adminCancel({ id: 1, reason: "차량 고장" });

    expect(result).toEqual({ success: true });
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(
      1,
      "cancelled",
      expect.objectContaining({
        cancelReason: "admin",
        cancelNote: expect.stringContaining("#7"),
      })
    );
    // Full refund (30000), not the tiered D-4 fee that the normal cancel path would apply.
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(
      1,
      "cancelled",
      expect.objectContaining({ cancelNote: expect.stringContaining("30000") })
    );
    expect(db.addPoints).not.toHaveBeenCalled(); // pointsUsed is 0 in fakeReservation()
  });
});
