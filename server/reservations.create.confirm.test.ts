import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getTripById: vi.fn(),
    reserveSeatsWithLock: vi.fn(),
    createPaymentWithItems: vi.fn(),
    getReservationsWithPaymentsByTripId: vi.fn(),
    confirmTripIfCollecting: vi.fn(),
    cancelTripIfCollecting: vi.fn(),
    getEventById: vi.fn(),
    addPoints: vi.fn(),
  };
});

vi.mock("./notify/tripMessenger", () => ({
  notifyTrip: vi.fn().mockResolvedValue({ sentCount: 0, failedCount: 0 }),
}));

import * as db from "./db";
import { appRouter } from "./routers";
import { notifyTrip } from "./notify/tripMessenger";
import type { Trip } from "../drizzle/schema";
import type { ReservationWithPayment } from "./db";
import type { TrpcContext } from "./_core/context";
import { dMinusBoundaryUtc } from "@shared/cancellationPolicy";

// departureAt = 2026-08-20 20:00 KST = 2026-08-20 11:00 UTC. D-5 00:00 KST = 2026-08-14T15:00:00Z.
const DEPARTURE_AT = new Date("2026-08-20T11:00:00.000Z");
const D5_BOUNDARY = dMinusBoundaryUtc(DEPARTURE_AT, 5);
// Trip created a couple of days after its own D-5 boundary (a "D-3에 생성된 트립" rush shuttle).
const RUSH_CREATED_AT = new Date(D5_BOUNDARY.getTime() + 2 * 24 * 60 * 60 * 1000);

function fakeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 1,
    eventId: 1,
    mode: "bus",
    status: "collecting",
    cancelReason: null,
    minCount: 1,
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
    createdAt: RUSH_CREATED_AT,
    updatedAt: RUSH_CREATED_AT,
    ...overrides,
  };
}

function fakeReservation(overrides: Partial<ReservationWithPayment> = {}): ReservationWithPayment {
  return {
    id: 999,
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
    createdAt: new Date(),
    updatedAt: new Date(),
    status: "paid",
    totalAmount: 30000,
    paymentMethod: "mock",
    chargeType: "prepaid",
    paidAt: new Date(),
    cancelledAt: null,
    cancelReason: null,
    cancelNote: null,
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
  };
}

describe("reservations.create - instant confirm exception for rush-created trips", () => {
  afterEach(() => {
    vi.mocked(db.getTripById).mockReset();
    vi.mocked(db.reserveSeatsWithLock).mockReset();
    vi.mocked(db.createPaymentWithItems).mockReset();
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockReset();
    vi.mocked(db.confirmTripIfCollecting).mockReset();
    vi.mocked(db.cancelTripIfCollecting).mockReset();
    vi.mocked(db.getEventById).mockReset();
    vi.mocked(db.addPoints).mockReset();
    vi.mocked(notifyTrip).mockClear();
  });

  it("(f) instantly confirms a trip created after its own D-5 boundary once minCount is reached", async () => {
    const trip = fakeTrip();
    vi.mocked(db.getTripById).mockResolvedValue(trip);
    vi.mocked(db.reserveSeatsWithLock).mockImplementation(async (_tripId, fn) =>
      fn({
        trip,
        reservations: [],
        insertReservation: vi.fn().mockResolvedValue(999),
        incrementCount: vi.fn().mockResolvedValue(undefined),
      } as any)
    );
    vi.mocked(db.createPaymentWithItems).mockResolvedValue(1);
    // Post-insert snapshot: the reservation that was just created, meeting minCount(1).
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([fakeReservation()]);
    vi.mocked(db.confirmTripIfCollecting).mockResolvedValue(true);
    vi.mocked(db.getEventById).mockResolvedValue({ title: "Test Event" } as any);

    const caller = appRouter.createCaller(makeUserCtx(42));
    await caller.reservations.create({
      tripId: 1,
      seats: 1,
      passengerName: "Test",
      passengerPhone: "010-0000-0000",
    });

    expect(db.confirmTripIfCollecting).toHaveBeenCalledWith(1);
    expect(db.cancelTripIfCollecting).not.toHaveBeenCalled();
    expect(notifyTrip).toHaveBeenCalledWith(
      1,
      "tripConfirmed",
      expect.objectContaining({ eventTitle: "Test Event" }),
      "all"
    );
  });

  it("does NOT instantly confirm a normally-created trip even when minCount is reached", async () => {
    const normalTrip = fakeTrip({ createdAt: new Date("2026-06-01T00:00:00.000Z") }); // well before its own D-5
    vi.mocked(db.getTripById).mockResolvedValue(normalTrip);
    vi.mocked(db.reserveSeatsWithLock).mockImplementation(async (_tripId, fn) =>
      fn({
        trip: normalTrip,
        reservations: [],
        insertReservation: vi.fn().mockResolvedValue(999),
        incrementCount: vi.fn().mockResolvedValue(undefined),
      } as any)
    );
    vi.mocked(db.createPaymentWithItems).mockResolvedValue(1);
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([fakeReservation()]);

    const caller = appRouter.createCaller(makeUserCtx(42));
    await caller.reservations.create({
      tripId: 1,
      seats: 1,
      passengerName: "Test",
      passengerPhone: "010-0000-0000",
    });

    expect(db.confirmTripIfCollecting).not.toHaveBeenCalled();
  });
});
