import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getPaymentByOrderId: vi.fn(),
    getTripById: vi.fn(),
    getEventById: vi.fn(),
    getReservationsWithPaymentsByTripId: vi.fn(),
    reserveSeatsWithLock: vi.fn(),
    createPaymentWithItems: vi.fn(),
    updatePaymentStatus: vi.fn(),
    confirmTripIfCollecting: vi.fn(),
    addPoints: vi.fn(),
  };
});

vi.mock("./notify/tripMessenger", () => ({
  notifyTrip: vi.fn().mockResolvedValue({ sentCount: 0, failedCount: 0 }),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

import * as db from "./db";
import { appRouter } from "./routers";
import type { Payment, Trip } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import type { TossOrderContext } from "./reservationFlow";

const DEPARTURE_AT = new Date("2026-08-20T11:00:00.000Z");

function fakeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 1,
    eventId: 1,
    mode: "bus",
    status: "collecting",
    cancelReason: null,
    minCount: 15,
    maxCount: 45,
    currentCount: 0,
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

function fakeOrderContext(overrides: Partial<TossOrderContext> = {}): TossOrderContext {
  return {
    kind: "reservation",
    userId: 42,
    tripId: 1,
    seats: 2,
    passengerName: "Test",
    passengerPhone: "010-0000-0000",
    pointsUsed: 0,
    ...overrides,
  };
}

function fakePendingPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 7,
    reservationId: null,
    totalAmount: 60000,
    status: "pending",
    method: "toss",
    chargeType: "prepaid",
    orderId: "bungae-testorder123456789012",
    tossPaymentKey: null,
    orderContext: fakeOrderContext(),
    paidAt: null,
    cancelledAt: null,
    cancelReason: null,
    cancelNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeUserCtx(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      name: "Test User",
      email: "user@test.com",
      loginMethod: "manus",
      role: "user",
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

function mockTossConfirmSuccess() {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith("/v1/payments/confirm")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          paymentKey: "pk_test_123",
          orderId: "bungae-testorder123456789012",
          status: "DONE",
          totalAmount: 60000,
          balanceAmount: 60000,
        }),
      };
    }
    if (String(url).includes("/cancel")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ paymentKey: "pk_test_123", status: "CANCELED", totalAmount: 60000, balanceAmount: 0 }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
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
  vi.mocked(db.getPaymentByOrderId).mockReset();
  vi.mocked(db.getTripById).mockReset();
  vi.mocked(db.getEventById).mockReset();
  vi.mocked(db.getReservationsWithPaymentsByTripId).mockReset();
  vi.mocked(db.reserveSeatsWithLock).mockReset();
  vi.mocked(db.createPaymentWithItems).mockReset();
  vi.mocked(db.updatePaymentStatus).mockReset();
  vi.mocked(db.confirmTripIfCollecting).mockReset();
  vi.mocked(db.addPoints).mockReset();
});

describe("payments.createTossOrder", () => {
  it("computes the amount server-side and stores a pending order with context", async () => {
    vi.mocked(db.getTripById).mockResolvedValue(fakeTrip());
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([]);
    vi.mocked(db.getEventById).mockResolvedValue({ id: 1, title: "Test Event" } as any);
    vi.mocked(db.createPaymentWithItems).mockResolvedValue(7);

    const caller = appRouter.createCaller(makeUserCtx(42));
    const result = await caller.payments.createTossOrder({
      tripId: 1,
      seats: 2,
      passengerName: "Test",
      passengerPhone: "010-0000-0000",
    });

    expect(result.amount).toBe(60000);
    expect(result.orderId).toMatch(/^bungae-/);
    expect(db.createPaymentWithItems).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: null,
        method: "toss",
        status: "pending",
        orderContext: expect.objectContaining({ kind: "reservation", userId: 42, tripId: 1, seats: 2 }),
      })
    );
  });
});

describe("payments.confirmToss", () => {
  it("rejects an amount mismatch WITHOUT calling the Toss confirm API (금액 변조 방어)", async () => {
    vi.mocked(db.getPaymentByOrderId).mockResolvedValue(fakePendingPayment({ totalAmount: 60000 }));

    const caller = appRouter.createCaller(makeUserCtx(42));
    await expect(
      caller.payments.confirmToss({
        paymentKey: "pk_test_123",
        orderId: "bungae-testorder123456789012",
        amount: 1000, // tampered
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(
      7,
      "cancelled",
      expect.objectContaining({ cancelReason: "payment_failed" })
    );
  });

  it("confirms with Toss, then finalizes the reservation and links the payment", async () => {
    const trip = fakeTrip();
    vi.mocked(db.getPaymentByOrderId).mockResolvedValue(fakePendingPayment());
    vi.mocked(db.getTripById).mockResolvedValue(trip);
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([]);
    vi.mocked(db.reserveSeatsWithLock).mockImplementation(async (_tripId, fn) =>
      fn({
        trip,
        reservations: [],
        insertReservation: vi.fn().mockResolvedValue(555),
        incrementCount: vi.fn().mockResolvedValue(undefined),
      } as any)
    );
    mockTossConfirmSuccess();

    const caller = appRouter.createCaller(makeUserCtx(42));
    const result = await caller.payments.confirmToss({
      paymentKey: "pk_test_123",
      orderId: "bungae-testorder123456789012",
      amount: 60000,
    });

    expect(result).toEqual({ kind: "reservation", reservationId: 555 });

    // 승인 API가 서버 보관 금액으로 호출됐는지
    const confirmCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/v1/payments/confirm"));
    expect(confirmCall).toBeTruthy();
    expect(JSON.parse(confirmCall![1].body)).toEqual({
      paymentKey: "pk_test_123",
      orderId: "bungae-testorder123456789012",
      amount: 60000,
    });

    expect(db.updatePaymentStatus).toHaveBeenCalledWith(
      7,
      "paid",
      expect.objectContaining({ tossPaymentKey: "pk_test_123", reservationId: 555 })
    );
  });

  it("auto-cancels the Toss payment in full when the seat lock fails after approval", async () => {
    const trip = fakeTrip();
    const pending = fakePendingPayment();
    vi.mocked(db.getPaymentByOrderId)
      .mockResolvedValueOnce(pending) // confirm 시작 시
      .mockResolvedValue(pending); // 실패 후 재조회 (여전히 pending)
    vi.mocked(db.getTripById).mockResolvedValue(trip);
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([]);
    // 승인 후 락 안에서 좌석 경쟁 패배
    vi.mocked(db.reserveSeatsWithLock).mockRejectedValue(
      Object.assign(new Error("좌석이 부족합니다."), { code: "BAD_REQUEST" })
    );
    mockTossConfirmSuccess();

    const caller = appRouter.createCaller(makeUserCtx(42));
    await expect(
      caller.payments.confirmToss({
        paymentKey: "pk_test_123",
        orderId: "bungae-testorder123456789012",
        amount: 60000,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // 전액 자동 취소 호출 (cancelAmount 미지정 = 전액) + 멱등키
    const cancelCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/cancel"));
    expect(cancelCall).toBeTruthy();
    expect(JSON.parse(cancelCall![1].body)).not.toHaveProperty("cancelAmount");
    expect(cancelCall![1].headers["Idempotency-Key"]).toBe("auto-cancel-7");

    expect(db.updatePaymentStatus).toHaveBeenCalledWith(
      7,
      "cancelled",
      expect.objectContaining({ cancelReason: "payment_failed" })
    );
  });

  it("returns the existing reservation when the success callback is submitted twice", async () => {
    vi.mocked(db.getPaymentByOrderId).mockResolvedValue(
      fakePendingPayment({ status: "paid", reservationId: 555, tossPaymentKey: "pk_test_123" })
    );

    const caller = appRouter.createCaller(makeUserCtx(42));
    const result = await caller.payments.confirmToss({
      paymentKey: "pk_test_123",
      orderId: "bungae-testorder123456789012",
      amount: 60000,
    });

    expect(result).toEqual({ kind: "reservation", reservationId: 555 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a confirm attempt by a different user", async () => {
    vi.mocked(db.getPaymentByOrderId).mockResolvedValue(fakePendingPayment());

    const caller = appRouter.createCaller(makeUserCtx(99));
    await expect(
      caller.payments.confirmToss({
        paymentKey: "pk_test_123",
        orderId: "bungae-testorder123456789012",
        amount: 60000,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
