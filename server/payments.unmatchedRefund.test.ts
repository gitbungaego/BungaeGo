import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getRideRequestsByEventId: vi.fn(),
    getLatestPaymentByRideRequestId: vi.fn(),
    updatePaymentStatus: vi.fn(),
    updateRideRequestStatus: vi.fn(),
    addPoints: vi.fn(),
  };
});

import * as db from "./db";
import { refundUnmatchedRideRequests } from "./payments";
import type { Payment, RideRequest } from "../drizzle/schema";

function fakeRequest(overrides: Partial<RideRequest> = {}): RideRequest {
  return {
    id: 1,
    eventId: 5,
    userId: 42,
    originAddress: null,
    originLat: "37.5",
    originLng: "127.0",
    targetArrivalAt: new Date(),
    groupKey: null,
    clusterId: null,
    tripId: null,
    boardingPointId: null,
    reservationId: null,
    status: "pending",
    seats: 1,
    passengerName: "T",
    passengerPhone: "010",
    passengerEmail: null,
    referralCodeUsed: null,
    pointsUsed: 0,
    totalAmount: 20000,
    paymentMethod: "mock",
    refundedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as RideRequest;
}

function fakeTossPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 7,
    reservationId: null,
    rideRequestId: 1,
    refundedAmount: 0,
    totalAmount: 20000,
    status: "paid",
    method: "toss",
    chargeType: "prepaid",
    orderId: "bungae-x",
    tossPaymentKey: "pk_test_1",
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

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("TOSS_SECRET_KEY", "test_sk_fake");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  vi.mocked(db.getRideRequestsByEventId).mockReset();
  vi.mocked(db.getLatestPaymentByRideRequestId).mockReset();
  vi.mocked(db.updatePaymentStatus).mockReset();
  vi.mocked(db.updateRideRequestStatus).mockReset();
  vi.mocked(db.addPoints).mockReset();
});

describe("refundUnmatchedRideRequests", () => {
  it("refunds pending/clustered requests, skips already-routed/failed ones", async () => {
    vi.mocked(db.getRideRequestsByEventId).mockResolvedValue([
      fakeRequest({ id: 1, status: "pending", pointsUsed: 3000 }),
      fakeRequest({ id: 2, status: "clustered" }),
      fakeRequest({ id: 3, status: "route_confirmed" }), // matched — skip
      fakeRequest({ id: 4, status: "failed_refunded" }), // already handled — skip
    ]);
    // Mock-payment requests (no toss row) — no external cancel.
    vi.mocked(db.getLatestPaymentByRideRequestId).mockResolvedValue(undefined);

    const result = await refundUnmatchedRideRequests(5, "테스트 환불");

    expect(result).toEqual({ refundedCount: 2, refundFailures: 0 });
    expect(db.updateRideRequestStatus).toHaveBeenCalledTimes(2);
    expect(db.updateRideRequestStatus).toHaveBeenCalledWith(1, "failed_refunded", expect.anything());
    expect(db.updateRideRequestStatus).toHaveBeenCalledWith(2, "failed_refunded", expect.anything());
    // Points refunded only for the request that used points.
    expect(db.addPoints).toHaveBeenCalledWith(42, 3000, "refund", "테스트 환불", "1");
    expect(db.addPoints).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("full-cancels a toss prepayment's remaining balance and marks it cancelled", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ paymentKey: "pk_test_1", status: "CANCELED", totalAmount: 20000, balanceAmount: 0 }),
    });
    vi.mocked(db.getRideRequestsByEventId).mockResolvedValue([fakeRequest({ id: 1, status: "pending", paymentMethod: "toss" })]);
    vi.mocked(db.getLatestPaymentByRideRequestId).mockResolvedValue(fakeTossPayment({ refundedAmount: 4000 }));

    const result = await refundUnmatchedRideRequests(5);

    // remaining = 20000 - 4000 = 16000, and since it's less than totalAmount a
    // cancelAmount is sent.
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).cancelAmount).toBe(16000);
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(
      7,
      "cancelled",
      expect.objectContaining({ cancelReason: "trip_not_confirmed", refundedAmount: 20000 })
    );
    expect(db.updateRideRequestStatus).toHaveBeenCalledWith(1, "failed_refunded", expect.anything());
    expect(result.refundFailures).toBe(0);
  });

  it("does NOT mark a request refunded when its toss cancel fails, and keeps going", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ code: "FAILED_INTERNAL_SYSTEM_PROCESSING", message: "err" }),
    });
    vi.mocked(db.getRideRequestsByEventId).mockResolvedValue([
      fakeRequest({ id: 1, status: "pending", paymentMethod: "toss" }),
      fakeRequest({ id: 2, status: "pending" }), // mock payment, refunds fine
    ]);
    vi.mocked(db.getLatestPaymentByRideRequestId)
      .mockResolvedValueOnce(fakeTossPayment({ id: 7 }))
      .mockResolvedValueOnce(undefined);

    const result = await refundUnmatchedRideRequests(5);

    // Failed toss request left untouched (retriable): payment kept paid, request not transitioned.
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(7, "paid", expect.objectContaining({ cancelNote: expect.stringContaining("실패") }));
    expect(db.updateRideRequestStatus).not.toHaveBeenCalledWith(1, "failed_refunded", expect.anything());
    // The mock request still processed.
    expect(db.updateRideRequestStatus).toHaveBeenCalledWith(2, "failed_refunded", expect.anything());
    expect(result).toEqual({ refundedCount: 1, refundFailures: 1 });
  });
});
