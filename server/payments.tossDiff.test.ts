import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getEventById: vi.fn(),
    getPaymentByOrderId: vi.fn(),
    getLatestPaymentByRideRequestId: vi.fn(),
    getRideRequestsByEventId: vi.fn(),
    getRideRequestById: vi.fn(),
    createRideRequest: vi.fn(),
    createPaymentWithItems: vi.fn(),
    updatePaymentStatus: vi.fn(),
    updateRideRequestStatus: vi.fn(),
    updateEvent: vi.fn(),
    addPoints: vi.fn(),
  };
});

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

import * as db from "./db";
import { appRouter } from "./routers";
import { applyRideRequestDifferenceRefund } from "./payments";
import type { Payment } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

function fakeTossPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 7,
    reservationId: null,
    rideRequestId: 100,
    refundedAmount: 0,
    totalAmount: 40000, // cap 20000 × 2석
    status: "paid",
    method: "toss",
    chargeType: "prepaid",
    orderId: "bungae-testorder123456789012",
    tossPaymentKey: "pk_test_123",
    orderContext: null,
    paidAt: new Date(),
    cancelledAt: null,
    cancelReason: null,
    cancelNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeAutoMatchEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "Auto Match Event",
    autoMatchEnabled: true,
    autoMatchPricePerSeat: 20000,
    matchingFrozenAt: null,
    lat: "37.5",
    lng: "127.0",
    ...overrides,
  } as any;
}

function makeCtx(userId: number, role: "user" | "admin" = "user"): TrpcContext {
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
    json: async () => ({ paymentKey: "pk_test_123", status: "PARTIAL_CANCELED", totalAmount: 40000, balanceAmount: 30000 }),
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

describe("applyRideRequestDifferenceRefund", () => {
  const baseOpts = { userId: 42, requestId: 100, seats: 2, capPricePerSeat: 20000, finalPricePerSeat: 15000 };

  it("partial-cancels exactly (cap - final) × seats and records the cumulative refund", async () => {
    mockCancelSuccess();
    await applyRideRequestDifferenceRefund(fakeTossPayment(), baseOpts);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/payments/pk_test_123/cancel");
    expect(JSON.parse(init.body).cancelAmount).toBe(10000);
    expect(init.headers["Idempotency-Key"]).toBe("diff-7-10000");
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(7, "paid", expect.objectContaining({ refundedAmount: 10000 }));
    expect(db.addPoints).not.toHaveBeenCalled();
  });

  it("skips entirely when the difference is zero", async () => {
    await applyRideRequestDifferenceRefund(fakeTossPayment(), { ...baseOpts, finalPricePerSeat: 20000 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.updatePaymentStatus).not.toHaveBeenCalled();
  });

  it("only tops up the delta when a recompute lowers the final price further (이중 환불 방지)", async () => {
    mockCancelSuccess();
    // 이전 커밋에서 이미 6000원 환불됨; 새 목표 10000원 → 4000원만 추가 취소
    await applyRideRequestDifferenceRefund(fakeTossPayment({ refundedAmount: 6000 }), baseOpts);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).cancelAmount).toBe(4000);
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(7, "paid", expect.objectContaining({ refundedAmount: 10000 }));
  });

  it("is a no-op when the target was already refunded (같은 커밋 재실행)", async () => {
    await applyRideRequestDifferenceRefund(fakeTossPayment({ refundedAmount: 10000 }), baseOpts);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refunds the cash portion via Toss and the rest as points when points covered most of the fare", async () => {
    mockCancelSuccess();
    // cap 40000 중 포인트 36000 사용 → 현금 4000. 차액 10000 = 현금 4000 + 포인트 6000
    await applyRideRequestDifferenceRefund(fakeTossPayment({ totalAmount: 4000 }), baseOpts);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).cancelAmount).toBe(4000);
    expect(db.addPoints).toHaveBeenCalledWith(42, 6000, "refund", expect.any(String), "100");
  });
});

describe("payments.confirmToss - rideRequest kind (상한가 선결제)", () => {
  it("confirms and creates the ride request, linking the payment via rideRequestId", async () => {
    const pending = fakeTossPayment({
      status: "pending",
      rideRequestId: null,
      tossPaymentKey: null,
      paidAt: null,
      orderContext: {
        kind: "rideRequest",
        userId: 42,
        eventId: 1,
        originLat: "37.49",
        originLng: "127.02",
        targetArrivalAt: Date.parse("2026-08-20T10:00:00Z"),
        seats: 2,
        passengerName: "Test",
        passengerPhone: "010-0000-0000",
        pointsUsed: 0,
      },
    });
    vi.mocked(db.getPaymentByOrderId).mockResolvedValue(pending);
    vi.mocked(db.getEventById).mockResolvedValue(fakeAutoMatchEvent());
    vi.mocked(db.createRideRequest).mockResolvedValue(100);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        paymentKey: "pk_test_123",
        orderId: pending.orderId,
        status: "DONE",
        totalAmount: 40000,
        balanceAmount: 40000,
      }),
    });

    const caller = appRouter.createCaller(makeCtx(42));
    const result = await caller.payments.confirmToss({
      paymentKey: "pk_test_123",
      orderId: pending.orderId!,
      amount: 40000,
    });

    expect(result).toEqual({ kind: "rideRequest", requestId: 100 });
    expect(db.createRideRequest).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 1, userId: 42, seats: 2, totalAmount: 40000, paymentMethod: "toss" })
    );
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(
      7,
      "paid",
      expect.objectContaining({ tossPaymentKey: "pk_test_123", rideRequestId: 100 })
    );
  });
});

describe("admin.matching.commit - finalPricePerSeat validation", () => {
  it("rejects a final price above the cap without touching anything", async () => {
    vi.mocked(db.getEventById).mockResolvedValue(fakeAutoMatchEvent());

    const caller = appRouter.createCaller(makeCtx(1, "admin"));
    await expect(
      caller.admin.matching.commit({ eventId: 1, finalPricePerSeat: 25000 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("admin.matching.freeze - toss full refund for unmatched requests", () => {
  it("cancels the remaining amount and marks the request failed_refunded", async () => {
    mockCancelSuccess();
    vi.mocked(db.getEventById).mockResolvedValue(fakeAutoMatchEvent());
    vi.mocked(db.getRideRequestsByEventId).mockResolvedValue([
      { id: 100, userId: 42, status: "pending", pointsUsed: 0, seats: 2 } as any,
    ]);
    vi.mocked(db.getLatestPaymentByRideRequestId).mockResolvedValue(fakeTossPayment({ refundedAmount: 6000 }));

    const caller = appRouter.createCaller(makeCtx(1, "admin"));
    const result = await caller.admin.matching.freeze({ eventId: 1 });

    // 남은 금액(40000-6000=34000)만 부분취소
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).cancelAmount).toBe(34000);
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(
      7,
      "cancelled",
      expect.objectContaining({ cancelReason: "trip_not_confirmed", refundedAmount: 40000 })
    );
    expect(db.updateRideRequestStatus).toHaveBeenCalledWith(100, "failed_refunded", expect.anything());
    expect(result.refundedCount).toBe(1);
    expect(result.refundFailures).toBe(0);
  });

  it("does NOT mark a request refunded when its Toss cancel fails, and keeps freezing", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ code: "FAILED_INTERNAL_SYSTEM_PROCESSING", message: "내부 오류" }),
    });
    vi.mocked(db.getEventById).mockResolvedValue(fakeAutoMatchEvent());
    vi.mocked(db.getRideRequestsByEventId).mockResolvedValue([
      { id: 100, userId: 42, status: "pending", pointsUsed: 0, seats: 2 } as any,
    ]);
    vi.mocked(db.getLatestPaymentByRideRequestId).mockResolvedValue(fakeTossPayment());

    const caller = appRouter.createCaller(makeCtx(1, "admin"));
    const result = await caller.admin.matching.freeze({ eventId: 1 });

    expect(db.updateRideRequestStatus).not.toHaveBeenCalled();
    expect(db.updateEvent).toHaveBeenCalledWith(1, expect.objectContaining({ matchingFrozenAt: expect.any(Date) }));
    expect(result.refundFailures).toBe(1);
  });
});
