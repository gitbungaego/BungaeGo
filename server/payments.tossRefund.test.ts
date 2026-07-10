import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getReservationById: vi.fn(),
    getTripById: vi.fn(),
    getLatestPaymentByReservationId: vi.fn(),
    getPaymentItemsByPaymentId: vi.fn(),
    getReservationsByTripId: vi.fn(),
    updatePaymentStatus: vi.fn(),
    decrementTripCount: vi.fn(),
    addPoints: vi.fn(),
    getReferralByReservationId: vi.fn(),
    updateReferralStatus: vi.fn(),
  };
});

import * as db from "./db";
import { appRouter } from "./routers";
import { cancelReservationsForTrip, refundTossPaymentIfNeeded } from "./payments";
import type { Payment, PaymentItem, Reservation, Trip } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import { dMinusBoundaryUtc } from "@shared/cancellationPolicy";

// departureAt = 2026-08-20 20:00 KST = 2026-08-20 11:00 UTC.
const DEPARTURE_AT = new Date("2026-08-20T11:00:00.000Z");
const D6_START = dMinusBoundaryUtc(DEPARTURE_AT, 6); // 50% fee tier
const BEFORE_D7 = new Date("2026-08-01T00:00:00.000Z"); // full refund tier

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

function fakeTossPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 7,
    reservationId: 1,
    totalAmount: 30000,
    status: "paid",
    method: "toss",
    chargeType: "prepaid",
    orderId: "bungae-testorder123456789012",
    tossPaymentKey: "pk_test_123",
    orderContext: null,
    paidAt: new Date("2026-06-01T00:00:00.000Z"),
    cancelledAt: null,
    cancelReason: null,
    cancelNote: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

function fakeFareItem(amount = 30000): PaymentItem {
  return { id: 1, paymentId: 7, type: "fare", amount, label: "셔틀 요금", createdAt: new Date() };
}

function fakeReservationRow(overrides: Partial<Reservation> = {}): Reservation {
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
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
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
  } as TrpcContext;
}

const fetchMock = vi.fn();

function mockCancelSuccess() {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ paymentKey: "pk_test_123", status: "CANCELED", totalAmount: 30000, balanceAmount: 0 }),
  });
}

function mockCancelAlreadyCanceled() {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({ code: "ALREADY_CANCELED_PAYMENT", message: "이미 취소된 결제 입니다." }),
  });
}

beforeEach(() => {
  vi.stubEnv("TOSS_SECRET_KEY", "test_gsk_fake_secret");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  Object.values(db).forEach((fn) => {
    if (vi.isMockFunction(fn)) fn.mockReset();
  });
});

describe("refundTossPaymentIfNeeded", () => {
  it("partial-cancels with the exact refundable amount and a stable idempotency key", async () => {
    mockCancelSuccess();
    await refundTossPaymentIfNeeded(fakeTossPayment(), 15000, "사용자 예약 취소");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/payments/pk_test_123/cancel");
    expect(JSON.parse(init.body)).toEqual({ cancelReason: "사용자 예약 취소", cancelAmount: 15000 });
    expect(init.headers["Idempotency-Key"]).toBe("refund-7-15000");
  });

  it("omits cancelAmount for a full refund (전액취소)", async () => {
    mockCancelSuccess();
    await refundTossPaymentIfNeeded(fakeTossPayment(), 30000, "관리자 취소 전액 환불");

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).not.toHaveProperty("cancelAmount");
  });

  it("treats re-cancelling an already-cancelled payment as success (멱등 재시도)", async () => {
    mockCancelAlreadyCanceled();
    await expect(refundTossPaymentIfNeeded(fakeTossPayment(), 30000, "재시도")).resolves.toBeUndefined();
  });

  it("is a no-op for non-toss payments and zero refunds", async () => {
    await refundTossPaymentIfNeeded(fakeTossPayment({ method: "mock", tossPaymentKey: null }), 30000, "x");
    await refundTossPaymentIfNeeded(fakeTossPayment(), 0, "x");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("reservations.cancel - toss refund integration", () => {
  it("partial-cancels by the fee-adjusted refundable amount at D-6 (50%)", async () => {
    mockCancelSuccess();
    vi.mocked(db.getReservationById).mockResolvedValue({
      ...fakeReservationRow(),
      status: "paid",
      totalAmount: 30000,
      paymentMethod: "toss",
      chargeType: "prepaid",
      paidAt: new Date(),
      cancelledAt: null,
      cancelReason: null,
      cancelNote: null,
    } as any);
    vi.mocked(db.getTripById).mockResolvedValue(fakeTrip());
    vi.mocked(db.getLatestPaymentByReservationId).mockResolvedValue(fakeTossPayment());
    vi.mocked(db.getPaymentItemsByPaymentId).mockResolvedValue([fakeFareItem()]);
    vi.mocked(db.getReferralByReservationId).mockResolvedValue(undefined);

    vi.useFakeTimers();
    vi.setSystemTime(D6_START);
    try {
      const caller = appRouter.createCaller(makeUserCtx(42));
      await caller.reservations.cancel({ id: 1 });
    } finally {
      vi.useRealTimers();
    }

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).cancelAmount).toBe(15000);
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(7, "cancelled", expect.anything());
    expect(db.decrementTripCount).toHaveBeenCalledWith(1, 1);
  });

  it("aborts the local cancellation when the Toss cancel API fails (사용자 재시도 가능)", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ code: "FAILED_INTERNAL_SYSTEM_PROCESSING", message: "내부 오류" }),
    });
    vi.mocked(db.getReservationById).mockResolvedValue({
      ...fakeReservationRow(),
      status: "paid",
      totalAmount: 30000,
      paymentMethod: "toss",
      chargeType: "prepaid",
      paidAt: new Date(),
      cancelledAt: null,
      cancelReason: null,
      cancelNote: null,
    } as any);
    vi.mocked(db.getTripById).mockResolvedValue(fakeTrip());
    vi.mocked(db.getLatestPaymentByReservationId).mockResolvedValue(fakeTossPayment());
    vi.mocked(db.getPaymentItemsByPaymentId).mockResolvedValue([fakeFareItem()]);

    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_D7);
    try {
      const caller = appRouter.createCaller(makeUserCtx(42));
      await expect(caller.reservations.cancel({ id: 1 })).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
    } finally {
      vi.useRealTimers();
    }

    expect(db.updatePaymentStatus).not.toHaveBeenCalled();
    expect(db.decrementTripCount).not.toHaveBeenCalled();
  });
});

describe("cancelReservationsForTrip - per-reservation isolation", () => {
  it("keeps processing other reservations when one toss refund fails, leaving the failed one retriable", async () => {
    // 예약 1 환불 실패, 예약 2 성공
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ code: "FAILED_INTERNAL_SYSTEM_PROCESSING", message: "내부 오류" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ paymentKey: "pk_test_456", status: "CANCELED", totalAmount: 30000, balanceAmount: 0 }),
      });

    vi.mocked(db.getReservationsByTripId).mockResolvedValue([
      fakeReservationRow({ id: 1 }),
      fakeReservationRow({ id: 2 }),
    ]);
    vi.mocked(db.getLatestPaymentByReservationId)
      .mockResolvedValueOnce(fakeTossPayment({ id: 7, reservationId: 1 }))
      .mockResolvedValueOnce(fakeTossPayment({ id: 8, reservationId: 2, tossPaymentKey: "pk_test_456" }));
    vi.mocked(db.getPaymentItemsByPaymentId).mockResolvedValue([fakeFareItem()]);

    await cancelReservationsForTrip(fakeTrip({ status: "cancelled" }));

    // 실패 건: paid 유지 + 실패 기록 / 성공 건: cancelled 전이
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(
      7,
      "paid",
      expect.objectContaining({ cancelNote: expect.stringContaining("환불 실패") })
    );
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(
      8,
      "cancelled",
      expect.objectContaining({ cancelReason: "trip_not_confirmed" })
    );
  });
});
