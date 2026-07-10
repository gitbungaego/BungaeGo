import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getPaymentByOrderId: vi.fn(),
    updatePaymentStatus: vi.fn(),
  };
});

import * as db from "./db";
import { handleTossWebhookEvent } from "./tossWebhook";
import type { Payment } from "../drizzle/schema";

function fakePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 7,
    reservationId: 555,
    totalAmount: 60000,
    status: "paid",
    method: "toss",
    chargeType: "prepaid",
    orderId: "bungae-testorder123456789012",
    tossPaymentKey: "pk_test_123",
    orderContext: { kind: "reservation", userId: 42 },
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

function mockVerificationResponse(status: string) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      paymentKey: "pk_test_123",
      orderId: "bungae-testorder123456789012",
      status,
      totalAmount: 60000,
      balanceAmount: 0,
    }),
  });
}

const CANCEL_EVENT = {
  eventType: "PAYMENT_STATUS_CHANGED",
  createdAt: "2026-07-10T00:00:00Z",
  data: { paymentKey: "pk_test_123", orderId: "bungae-testorder123456789012", status: "CANCELED" },
};

beforeEach(() => {
  vi.stubEnv("TOSS_SECRET_KEY", "test_gsk_fake_secret");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  vi.mocked(db.getPaymentByOrderId).mockReset();
  vi.mocked(db.updatePaymentStatus).mockReset();
});

describe("handleTossWebhookEvent", () => {
  it("verifies via the payments GET API instead of trusting the payload, then syncs a cancel", async () => {
    mockVerificationResponse("CANCELED");
    vi.mocked(db.getPaymentByOrderId).mockResolvedValue(fakePayment({ status: "paid" }));

    const outcome = await handleTossWebhookEvent(CANCEL_EVENT);

    expect(outcome.status).toBe(200);
    // 검증 조회가 시크릿 키 Basic 인증으로 나갔는지
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/payments/pk_test_123");
    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(7, "cancelled", expect.anything());
  });

  it("is idempotent: a duplicate delivery does not transition twice", async () => {
    mockVerificationResponse("CANCELED");
    // 1회차: paid → cancelled 전이. 2회차: 이미 cancelled라 no-op.
    vi.mocked(db.getPaymentByOrderId)
      .mockResolvedValueOnce(fakePayment({ status: "paid" }))
      .mockResolvedValueOnce(fakePayment({ status: "cancelled" }));

    const first = await handleTossWebhookEvent(CANCEL_EVENT);
    const second = await handleTossWebhookEvent(CANCEL_EVENT);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.updatePaymentStatus).toHaveBeenCalledTimes(1);
  });

  it("ignores events for unknown orders (forged or non-toss)", async () => {
    mockVerificationResponse("CANCELED");
    vi.mocked(db.getPaymentByOrderId).mockResolvedValue(undefined);

    const outcome = await handleTossWebhookEvent(CANCEL_EVENT);

    expect(outcome.status).toBe(200);
    expect(db.updatePaymentStatus).not.toHaveBeenCalled();
  });

  it("returns 500 when verification fails so Toss retries", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const outcome = await handleTossWebhookEvent(CANCEL_EVENT);

    expect(outcome.status).toBe(500);
    expect(db.updatePaymentStatus).not.toHaveBeenCalled();
  });

  it("marks a pending order failed when Toss reports ABORTED", async () => {
    mockVerificationResponse("ABORTED");
    vi.mocked(db.getPaymentByOrderId).mockResolvedValue(fakePayment({ status: "pending", reservationId: null }));

    const outcome = await handleTossWebhookEvent(CANCEL_EVENT);

    expect(outcome.status).toBe(200);
    expect(db.updatePaymentStatus).toHaveBeenCalledWith(
      7,
      "cancelled",
      expect.objectContaining({ cancelReason: "payment_failed" })
    );
  });
});
