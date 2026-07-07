import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return {
    ...actual,
    getTripsByStatus: vi.fn(),
    getReservationsWithPaymentsByTripId: vi.fn(),
    confirmTripIfCollecting: vi.fn(),
    cancelTripIfCollecting: vi.fn(),
    getEventById: vi.fn(),
  };
});

vi.mock("../payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../payments")>();
  return { ...actual, cancelReservationsForTrip: vi.fn() };
});

vi.mock("../notify/tripMessenger", () => ({
  notifyTrip: vi.fn().mockResolvedValue({ sentCount: 0, failedCount: 0 }),
}));

import * as db from "../db";
import * as payments from "../payments";
import { notifyTrip } from "../notify/tripMessenger";
import { runTripConfirmOrCancelJudgment } from "./tripConfirmScheduler";
import type { ReservationWithPayment, Trip } from "../../drizzle/schema";
import { dMinusBoundaryUtc } from "@shared/cancellationPolicy";

// departureAt = 2026-08-20 20:00 KST = 2026-08-20 11:00 UTC. D-5 00:00 KST = 2026-08-14T15:00:00Z.
const DEPARTURE_AT = new Date("2026-08-20T11:00:00.000Z");
const D5_BOUNDARY = dMinusBoundaryUtc(DEPARTURE_AT, 5);
const AFTER_D5 = new Date(D5_BOUNDARY.getTime() + 60 * 60 * 1000);
const BEFORE_D5 = new Date(D5_BOUNDARY.getTime() - 60 * 60 * 1000);

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
    createdAt: new Date("2026-06-01T00:00:00.000Z"), // well before its own D-5 (normal trip)
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

function fakeReservation(overrides: Partial<ReservationWithPayment> = {}): ReservationWithPayment {
  return {
    id: 1,
    userId: 1,
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

describe("runTripConfirmOrCancelJudgment", () => {
  afterEach(() => {
    vi.mocked(db.getTripsByStatus).mockReset();
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockReset();
    vi.mocked(db.confirmTripIfCollecting).mockReset();
    vi.mocked(db.cancelTripIfCollecting).mockReset();
    vi.mocked(db.getEventById).mockReset();
    vi.mocked(payments.cancelReservationsForTrip).mockReset();
    vi.mocked(notifyTrip).mockClear();
  });

  it("(a) confirms a trip that reached D-5 with minCount met", async () => {
    const trip = fakeTrip();
    vi.mocked(db.getTripsByStatus).mockResolvedValueOnce([trip]);
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValueOnce([
      fakeReservation({ seats: 15 }),
    ]);
    vi.mocked(db.confirmTripIfCollecting).mockResolvedValueOnce(true);
    vi.mocked(db.getEventById).mockResolvedValueOnce({ title: "Test Event" } as any);

    await runTripConfirmOrCancelJudgment(AFTER_D5);

    expect(db.confirmTripIfCollecting).toHaveBeenCalledWith(trip.id);
    expect(db.cancelTripIfCollecting).not.toHaveBeenCalled();
    expect(notifyTrip).toHaveBeenCalledWith(
      trip.id,
      "tripConfirmed",
      expect.objectContaining({ eventTitle: "Test Event" }),
      "all"
    );
  });

  it("(b) auto-cancels a trip that reached D-5 with minCount unmet, records cancelReason, and refunds", async () => {
    const trip = fakeTrip();
    vi.mocked(db.getTripsByStatus).mockResolvedValueOnce([trip]);
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValueOnce([
      fakeReservation({ seats: 3 }), // below minCount 15
    ]);
    vi.mocked(db.cancelTripIfCollecting).mockResolvedValueOnce(true);
    vi.mocked(db.getEventById).mockResolvedValueOnce({ title: "Test Event" } as any);

    await runTripConfirmOrCancelJudgment(AFTER_D5);

    expect(db.cancelTripIfCollecting).toHaveBeenCalledWith(trip.id, "min_count_not_met");
    expect(db.confirmTripIfCollecting).not.toHaveBeenCalled();
    expect(payments.cancelReservationsForTrip).toHaveBeenCalledWith(trip);
    expect(notifyTrip).toHaveBeenCalledWith(
      trip.id,
      "tripCancelled",
      expect.objectContaining({ eventTitle: "Test Event" }),
      "all"
    );
  });

  it("does not touch a collecting trip that hasn't reached its D-5 boundary yet", async () => {
    const trip = fakeTrip();
    vi.mocked(db.getTripsByStatus).mockResolvedValueOnce([trip]);

    await runTripConfirmOrCancelJudgment(BEFORE_D5);

    expect(db.getReservationsWithPaymentsByTripId).not.toHaveBeenCalled();
    expect(db.confirmTripIfCollecting).not.toHaveBeenCalled();
    expect(db.cancelTripIfCollecting).not.toHaveBeenCalled();
  });

  it("(f) skips a trip created after its own D-5 boundary (rush-created exception)", async () => {
    // createdAt is after D5_BOUNDARY, so this trip has no D-5 judgment window.
    const trip = fakeTrip({ createdAt: new Date(D5_BOUNDARY.getTime() + 1000) });
    vi.mocked(db.getTripsByStatus).mockResolvedValueOnce([trip]);

    await runTripConfirmOrCancelJudgment(AFTER_D5);

    expect(db.getReservationsWithPaymentsByTripId).not.toHaveBeenCalled();
    expect(db.confirmTripIfCollecting).not.toHaveBeenCalled();
    expect(db.cancelTripIfCollecting).not.toHaveBeenCalled();
  });

  it("continues processing other trips when one trip's judgment throws", async () => {
    const failingTrip = fakeTrip({ id: 1 });
    const okTrip = fakeTrip({ id: 2 });
    vi.mocked(db.getTripsByStatus).mockResolvedValueOnce([failingTrip, okTrip]);
    vi.mocked(db.getReservationsWithPaymentsByTripId)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([fakeReservation({ seats: 15 })]);
    vi.mocked(db.confirmTripIfCollecting).mockResolvedValueOnce(true);
    vi.mocked(db.getEventById).mockResolvedValueOnce({ title: "Test Event" } as any);

    await expect(runTripConfirmOrCancelJudgment(AFTER_D5)).resolves.not.toThrow();

    expect(db.confirmTripIfCollecting).toHaveBeenCalledWith(okTrip.id);
  });
});
