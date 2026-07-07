import { describe, expect, it } from "vitest";
import { computeRefundableAmount } from "./payments";
import type { PaymentItem, Trip } from "../drizzle/schema";

// departureAt = 2026-08-20 20:00 KST = 2026-08-20 11:00 UTC.
const DEPARTURE_AT = new Date("2026-08-20T11:00:00.000Z");
const RESERVED_LONG_AGO = new Date("2026-07-01T00:00:00.000Z");

function fakeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 1,
    eventId: 1,
    mode: "bus",
    status: "confirmed",
    cancelReason: null,
    minCount: 15,
    maxCount: 45,
    currentCount: 10,
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

function fakeItem(overrides: Partial<PaymentItem> = {}): PaymentItem {
  return {
    id: 1,
    paymentId: 1,
    type: "fare",
    amount: 30000,
    label: "셔틀 요금",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("computeRefundableAmount - fare item under user_request", () => {
  it("refunds in full before D-7", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const amount = computeRefundableAmount(fakeItem(), fakeTrip(), RESERVED_LONG_AGO, now, "user_request");
    expect(amount).toBe(30000);
  });

  it("applies a 25% fee at D-7", () => {
    const now = new Date("2026-08-12T15:00:00.000Z"); // D-7 00:00 KST
    const amount = computeRefundableAmount(fakeItem(), fakeTrip(), RESERVED_LONG_AGO, now, "user_request");
    expect(amount).toBe(22500);
  });

  it("applies a 50% fee at D-6", () => {
    const now = new Date("2026-08-13T15:00:00.000Z"); // D-6 00:00 KST
    const amount = computeRefundableAmount(fakeItem(), fakeTrip(), RESERVED_LONG_AGO, now, "user_request");
    expect(amount).toBe(15000);
  });

  it("refunds nothing past D-5 (defensive - reservations.cancel should already reject this)", () => {
    const now = new Date("2026-08-14T15:00:00.000Z"); // D-5 00:00 KST
    const amount = computeRefundableAmount(fakeItem(), fakeTrip(), RESERVED_LONG_AGO, now, "user_request");
    expect(amount).toBe(0);
  });

  it("refunds in full within the 1hr creation grace, even past D-5", () => {
    const reservedAt = new Date("2026-08-19T00:00:00.000Z");
    const now = new Date(reservedAt.getTime() + 30 * 60 * 1000);
    const amount = computeRefundableAmount(fakeItem(), fakeTrip(), reservedAt, now, "user_request");
    expect(amount).toBe(30000);
  });
});

describe("computeRefundableAmount - discount item is never fee-affected", () => {
  it("refunds the full (negative) discount amount even at 50% fare fee tier", () => {
    const now = new Date("2026-08-13T15:00:00.000Z"); // D-6, 50% fare fee tier
    const discountItem = fakeItem({ type: "discount", amount: -5000, label: "포인트 할인" });
    const amount = computeRefundableAmount(discountItem, fakeTrip(), RESERVED_LONG_AGO, now, "user_request");
    expect(amount).toBe(-5000);
  });
});

describe("computeRefundableAmount - trip_not_confirmed bypasses the fee tier entirely", () => {
  it("refunds the fare in full even in the normally-forbidden D-5+ window", () => {
    const now = new Date("2026-08-19T00:00:00.000Z"); // well past D-5
    const amount = computeRefundableAmount(fakeItem(), fakeTrip(), RESERVED_LONG_AGO, now, "trip_not_confirmed");
    expect(amount).toBe(30000);
  });
});

describe("computeRefundableAmount - admin bypasses the fee tier entirely", () => {
  it("refunds the fare in full even in the normally-forbidden D-5+ window", () => {
    const now = new Date("2026-08-19T00:00:00.000Z"); // well past D-5
    const amount = computeRefundableAmount(fakeItem(), fakeTrip(), RESERVED_LONG_AGO, now, "admin");
    expect(amount).toBe(30000);
  });
});

describe("computeRefundableAmount - unregistered item type", () => {
  it("throws for a theme_fee item under user_request (no policy registered yet)", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const themeFeeItem = fakeItem({ type: "theme_fee", amount: 5000, label: "테마 추가 요금" });
    expect(() =>
      computeRefundableAmount(themeFeeItem, fakeTrip(), RESERVED_LONG_AGO, now, "user_request")
    ).toThrow(/No refund policy registered/);
  });
});
