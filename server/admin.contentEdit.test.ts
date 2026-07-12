import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getEventById: vi.fn(),
    updateEvent: vi.fn(),
    updateEventStatus: vi.fn(),
    countReservationsByEventId: vi.fn(),
    deleteEventCascade: vi.fn(),
    getEventDeletionImpact: vi.fn(),
    cascadeDeleteEventWithRefunds: vi.fn(),
    getTripById: vi.fn(),
    updateTrip: vi.fn(),
    updateTripStatus: vi.fn(),
    getReservationsWithPaymentsByTripId: vi.fn(),
    getBoardingPointById: vi.fn(),
    updateBoardingPoint: vi.fn(),
    deleteBoardingPoint: vi.fn(),
  };
});

vi.mock("./payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./payments")>();
  return { ...actual, cancelReservationsForTrip: vi.fn() };
});

vi.mock("./toss", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./toss")>();
  return { ...actual, cancelTossPayment: vi.fn().mockResolvedValue({ payment: null, alreadyCanceled: false }) };
});

vi.mock("./notify/tripMessenger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./notify/tripMessenger")>();
  return { ...actual, notifyEventCancellation: vi.fn().mockResolvedValue({ sentCount: 0, failedCount: 0 }) };
});

vi.mock("./_core/notification", () => ({ notifyOwner: vi.fn().mockResolvedValue(true) }));

import * as db from "./db";
import { cancelReservationsForTrip } from "./payments";
import { cancelTossPayment } from "./toss";
import { notifyEventCancellation } from "./notify/tripMessenger";
import { appRouter } from "./routers";
import type { BoardingPoint, Event, ReservationWithPayment, Trip } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

function ctx(role: "user" | "admin"): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "u-1",
      name: "T",
      email: "t@test.com",
      loginMethod: "manus",
      role,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      referralCode: "C1",
      pointsBalance: 0,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

function fakeEvent(o: Partial<Event> = {}): Event {
  return {
    id: 5, title: "E", category: "concert", eventDate: new Date(), venue: "V", address: null,
    lat: null, lng: null, imageUrl: null, description: null, status: "active", creatorId: 99,
    organizerName: null, searchAliases: null, tags: null, autoMatchEnabled: false,
    autoMatchPricePerSeat: null, matchingFrozenAt: null, matchingFrozenBy: null,
    createdAt: new Date(), updatedAt: new Date(), ...o,
  };
}

function fakeTrip(o: Partial<Trip> = {}): Trip {
  return {
    id: 10, eventId: 5, mode: "bus", status: "collecting", cancelReason: null, minCount: 15,
    maxCount: 45, currentCount: 0, price: 30000, departureAt: new Date(), returnAt: null,
    isRoundTrip: false, operatorName: null, operatorContact: null, notes: null, creatorId: 99,
    sourceClusterId: null, theme: "standard", themeConfig: null, createdAt: new Date(), updatedAt: new Date(), ...o,
  };
}

function fakeResv(status: ReservationWithPayment["status"]): ReservationWithPayment {
  return {
    id: 1, userId: 42, tripId: 10, boardingPointId: null, seats: 1, seatNo: null, pointsUsed: 0,
    passengerName: "P", passengerPhone: "010", passengerEmail: null, qrToken: null, referralCode: null,
    createdAt: new Date(), updatedAt: new Date(), status, totalAmount: 30000, paymentMethod: "mock",
    chargeType: "prepaid", paidAt: new Date(), cancelledAt: null, cancelReason: null, cancelNote: null,
  } as ReservationWithPayment;
}

function fakeBp(o: Partial<BoardingPoint> = {}): BoardingPoint {
  return { id: 7, tripId: 10, name: "S", address: null, lat: null, lng: null, pickupTime: null, order: 0, createdAt: new Date(), updatedAt: new Date(), ...o };
}

afterEach(() => {
  Object.values(db).forEach((f) => { if (vi.isMockFunction(f)) f.mockReset(); });
  vi.mocked(cancelReservationsForTrip).mockReset();
});

describe("admin content edit/delete - authorization", () => {
  it("rejects a non-admin from every procedure with FORBIDDEN", async () => {
    const caller = appRouter.createCaller(ctx("user"));
    await expect(caller.admin.events.update({ id: 5, title: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.admin.events.delete({ id: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.admin.trips.update({ id: 10, price: 1000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.admin.trips.delete({ id: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.admin.boardingPoints.delete({ id: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.updateEvent).not.toHaveBeenCalled();
  });
});

describe("admin.events.update", () => {
  it("edits any member's event regardless of owner", async () => {
    vi.mocked(db.getEventById).mockResolvedValue(fakeEvent({ creatorId: 99 }));
    const caller = appRouter.createCaller(ctx("admin"));
    await caller.admin.events.update({ id: 5, title: "새 제목", tags: "K-POP", eventDate: Date.parse("2026-09-01T10:00:00Z") });
    expect(db.updateEvent).toHaveBeenCalledWith(5, expect.objectContaining({ title: "새 제목", tags: "K-POP", eventDate: expect.any(Date) }));
  });
});

describe("admin.events.delete - soft/hard policy", () => {
  it("soft delete sets status=deleted (default, no reservations)", async () => {
    vi.mocked(db.getEventById).mockResolvedValue(fakeEvent());
    vi.mocked(db.getEventDeletionImpact).mockResolvedValue({ tripCount: 0, reservationCount: 0, totalRefund: 0 });
    const caller = appRouter.createCaller(ctx("admin"));
    const r = await caller.admin.events.delete({ id: 5 });
    expect(r.mode).toBe("soft");
    expect(db.updateEventStatus).toHaveBeenCalledWith(5, "deleted");
    expect(db.deleteEventCascade).not.toHaveBeenCalled();
  });

  it("hard delete is rejected when reservations exist", async () => {
    vi.mocked(db.getEventById).mockResolvedValue(fakeEvent());
    vi.mocked(db.countReservationsByEventId).mockResolvedValue(3);
    const caller = appRouter.createCaller(ctx("admin"));
    await expect(caller.admin.events.delete({ id: 5, hard: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(db.deleteEventCascade).not.toHaveBeenCalled();
  });

  it("hard delete proceeds when zero reservations", async () => {
    vi.mocked(db.getEventById).mockResolvedValue(fakeEvent());
    vi.mocked(db.countReservationsByEventId).mockResolvedValue(0);
    const caller = appRouter.createCaller(ctx("admin"));
    const r = await caller.admin.events.delete({ id: 5, hard: true });
    expect(r.mode).toBe("hard");
    expect(db.deleteEventCascade).toHaveBeenCalledWith(5);
  });
});

describe("admin.events.delete - cascade (reservations present)", () => {
  it("returns the impact and does NOT delete when reservations exist and confirmCascade is false", async () => {
    vi.mocked(db.getEventById).mockResolvedValue(fakeEvent());
    vi.mocked(db.getEventDeletionImpact).mockResolvedValue({ tripCount: 2, reservationCount: 5, totalRefund: 145000 });

    const caller = appRouter.createCaller(ctx("admin"));
    const r = await caller.admin.events.delete({ id: 5 });

    expect(r).toEqual({ mode: "needsConfirm", tripCount: 2, reservationCount: 5, totalRefund: 145000 });
    expect(db.cascadeDeleteEventWithRefunds).not.toHaveBeenCalled();
    expect(db.updateEventStatus).not.toHaveBeenCalled();
    expect(notifyEventCancellation).not.toHaveBeenCalled();
  });

  it("soft-deletes directly when there are no reservations", async () => {
    vi.mocked(db.getEventById).mockResolvedValue(fakeEvent());
    vi.mocked(db.getEventDeletionImpact).mockResolvedValue({ tripCount: 1, reservationCount: 0, totalRefund: 0 });

    const caller = appRouter.createCaller(ctx("admin"));
    const r = await caller.admin.events.delete({ id: 5 });

    expect(r.mode).toBe("soft");
    expect(db.updateEventStatus).toHaveBeenCalledWith(5, "deleted");
    expect(db.cascadeDeleteEventWithRefunds).not.toHaveBeenCalled();
  });

  it("on confirmCascade: runs the transactional cascade then notifies affected users", async () => {
    vi.mocked(db.getEventById).mockResolvedValue(fakeEvent({ title: "취소되는 이벤트" }));
    vi.mocked(db.getEventDeletionImpact).mockResolvedValue({ tripCount: 2, reservationCount: 3, totalRefund: 90000 });
    vi.mocked(db.cascadeDeleteEventWithRefunds).mockResolvedValue({
      tripCount: 2,
      reservationCount: 3,
      totalRefund: 90000,
      pointsRefunded: 2000,
      tossRefundJobs: [{ paymentId: 11, paymentKey: "pk_x", amount: 30000 }],
      recipients: [
        { userId: 42, reservationId: 1, seats: 1, passengerName: "A", passengerPhone: "010", passengerEmail: null },
        { userId: 43, reservationId: 2, seats: 2, passengerName: "B", passengerPhone: null, passengerEmail: "b@x.com" },
      ],
    });

    const caller = appRouter.createCaller(ctx("admin"));
    const r = await caller.admin.events.delete({ id: 5, confirmCascade: true });

    expect(db.cascadeDeleteEventWithRefunds).toHaveBeenCalledWith(5);
    // Toss job cancelled externally (post-commit).
    expect(cancelTossPayment).toHaveBeenCalledWith(expect.objectContaining({ paymentKey: "pk_x" }));
    // Cancellation notice sent to the deduped recipient list with the event title.
    expect(notifyEventCancellation).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ userId: 42 }), expect.objectContaining({ userId: 43 })]),
      "취소되는 이벤트"
    );
    expect(r).toMatchObject({ mode: "cascade", reservationCount: 3, totalRefund: 90000, pointsRefunded: 2000 });
  });
});

describe("admin.trips.update - confirmed protection", () => {
  it("blocks a price change on a confirmed trip without the force flag", async () => {
    vi.mocked(db.getTripById).mockResolvedValue(fakeTrip({ status: "confirmed", price: 30000 }));
    const caller = appRouter.createCaller(ctx("admin"));
    await expect(caller.admin.trips.update({ id: 10, price: 25000 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(db.updateTrip).not.toHaveBeenCalled();
  });

  it("allows a confirmed price change with forceConfirmedEdit", async () => {
    vi.mocked(db.getTripById).mockResolvedValue(fakeTrip({ status: "confirmed", price: 30000 }));
    const caller = appRouter.createCaller(ctx("admin"));
    await caller.admin.trips.update({ id: 10, price: 25000, forceConfirmedEdit: true });
    expect(db.updateTrip).toHaveBeenCalledWith(10, expect.objectContaining({ price: 25000 }));
  });

  it("allows non-price edits on a confirmed trip (e.g. notes typo) without force", async () => {
    vi.mocked(db.getTripById).mockResolvedValue(fakeTrip({ status: "confirmed", price: 30000 }));
    const caller = appRouter.createCaller(ctx("admin"));
    await caller.admin.trips.update({ id: 10, notes: "오타 수정" });
    expect(db.updateTrip).toHaveBeenCalledWith(10, expect.objectContaining({ notes: "오타 수정" }));
  });

  it("rejects minCount > maxCount against the merged result", async () => {
    vi.mocked(db.getTripById).mockResolvedValue(fakeTrip({ minCount: 10, maxCount: 40, status: "collecting" }));
    const caller = appRouter.createCaller(ctx("admin"));
    await expect(caller.admin.trips.update({ id: 10, minCount: 50 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("admin.trips.delete - refund gating", () => {
  it("rejects deletion with active reservations unless confirmRefund", async () => {
    vi.mocked(db.getTripById).mockResolvedValue(fakeTrip({ status: "collecting" }));
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([fakeResv("paid"), fakeResv("paid")]);
    const caller = appRouter.createCaller(ctx("admin"));
    await expect(caller.admin.trips.delete({ id: 10 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(cancelReservationsForTrip).not.toHaveBeenCalled();
    expect(db.updateTripStatus).not.toHaveBeenCalled();
  });

  it("refunds everyone then cancels when confirmRefund is set", async () => {
    vi.mocked(db.getTripById).mockResolvedValue(fakeTrip({ status: "collecting" }));
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([fakeResv("paid")]);
    const caller = appRouter.createCaller(ctx("admin"));
    const r = await caller.admin.trips.delete({ id: 10, confirmRefund: true });
    expect(cancelReservationsForTrip).toHaveBeenCalled();
    expect(db.updateTripStatus).toHaveBeenCalledWith(10, "cancelled", "admin_cancel");
    expect(r.refundedCount).toBe(1);
  });

  it("cancels directly when there are no active reservations", async () => {
    vi.mocked(db.getTripById).mockResolvedValue(fakeTrip({ status: "collecting" }));
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([]);
    const caller = appRouter.createCaller(ctx("admin"));
    const r = await caller.admin.trips.delete({ id: 10 });
    expect(cancelReservationsForTrip).not.toHaveBeenCalled();
    expect(db.updateTripStatus).toHaveBeenCalledWith(10, "cancelled", "admin_cancel");
    expect(r.refundedCount).toBe(0);
  });
});

describe("admin.boardingPoints", () => {
  it("updates a stop owner-agnostically", async () => {
    vi.mocked(db.getBoardingPointById).mockResolvedValue(fakeBp());
    const caller = appRouter.createCaller(ctx("admin"));
    await caller.admin.boardingPoints.update({ id: 7, name: "강남역 3번 출구", pickupTime: Date.parse("2026-09-01T08:00:00Z") });
    expect(db.updateBoardingPoint).toHaveBeenCalledWith(7, expect.objectContaining({ name: "강남역 3번 출구", pickupTime: expect.any(Date) }));
  });

  it("deletes a stop", async () => {
    vi.mocked(db.getBoardingPointById).mockResolvedValue(fakeBp());
    const caller = appRouter.createCaller(ctx("admin"));
    await caller.admin.boardingPoints.delete({ id: 7 });
    expect(db.deleteBoardingPoint).toHaveBeenCalledWith(7);
  });
});
