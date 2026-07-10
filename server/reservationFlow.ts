import { TRPCError } from "@trpc/server";
import { isCreatedAfterOwnD5 } from "@shared/cancellationPolicy";
import type { User } from "../drizzle/schema";
import {
  addPoints,
  confirmTripIfCollecting,
  createReferral,
  getEventById,
  getReferralByPair,
  getReservationsWithPaymentsByTripId,
  getTripById,
  getUserByReferralCode,
  reserveSeatsWithLock,
} from "./db";
import { getPolicy } from "./matching/confirmPolicy";
import { notifyTrip } from "./notify/tripMessenger";

// ─── Points usage guard ───────────────────────────────────────────────────────
export function validatePointsUsage(pointsUsed: number, userBalance: number, fareAmount: number): void {
  if (pointsUsed > userBalance) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "보유 포인트가 부족합니다." });
  }
  if (pointsUsed > fareAmount) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "포인트 사용액이 결제 금액을 초과할 수 없습니다." });
  }
}

// ─── Trip confirm policy helpers ──────────────────────────────────────────────
// Normal trips are no longer confirmed the instant minCount is reached — the
// D-5 scheduler (server/scheduler/tripConfirmScheduler.ts) makes that call.
// The only case this instant path still fires for is a trip created after
// its own D-5 boundary ("급하게 만든 셔틀"), which has no future D-5 judgment
// moment for the scheduler to act on.
export async function maybeConfirmTrip(tripId: number): Promise<void> {
  const trip = await getTripById(tripId);
  if (!trip) return;
  if (!isCreatedAfterOwnD5(trip)) return;
  const policy = getPolicy(trip.theme);
  const tripReservations = await getReservationsWithPaymentsByTripId(tripId);
  if (!policy.canConfirm(trip, tripReservations)) return;

  // Idempotent: only the caller that actually flips collecting -> confirmed
  // gets true back, so confirm-only follow-up never double-fires when two
  // reservations for the same trip cross minCount around the same time.
  const didConfirm = await confirmTripIfCollecting(tripId);
  if (!didConfirm) return;

  const event = await getEventById(trip.eventId);
  await notifyTrip(
    tripId,
    "tripConfirmed",
    { eventTitle: event?.title ?? "셔틀", departureAt: trip.departureAt },
    "all"
  ).catch((error) => console.warn("[maybeConfirmTrip] notifyTrip failed:", error));
}

// ─── Toss pending-order context ───────────────────────────────────────────────
// Stored server-side on the pending payment row at order creation, so the
// confirm step never has to trust order details from the client again — only
// paymentKey/orderId/amount come back through the redirect.
export type TossOrderContext = { kind: "reservation"; userId: number } & ReservationOrderInput;

// ─── Shared reservation creation flow ─────────────────────────────────────────
export interface ReservationOrderInput {
  tripId: number;
  boardingPointId?: number;
  seats: number;
  passengerName: string;
  passengerPhone: string;
  passengerEmail?: string;
  pointsUsed: number;
  referralCode?: string;
}

/**
 * Seat-locked reservation creation shared by the mock path
 * (reservations.create) and the Toss confirm path. Everything except the
 * payment record itself: `attachPayment` runs right after the reservation
 * insert commits, so each caller attaches its own payment (mock: create a
 * paid record; toss: link the already-approved pending order).
 */
export async function finalizeReservation(
  user: User,
  input: ReservationOrderInput,
  attachPayment: (reservationId: number) => Promise<void>
): Promise<number> {
  if (user.status === "suspended") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "정지된 계정은 예약을 생성할 수 없습니다. 고객센터로 문의해주세요.",
    });
  }

  const trip = await getTripById(input.tripId);
  if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "셔틀을 찾을 수 없습니다." });

  validatePointsUsage(input.pointsUsed, user.pointsBalance, trip.price * input.seats);

  // Handle referral (doesn't touch seat capacity, safe outside the lock)
  let referrerId: number | undefined;
  if (input.referralCode) {
    const referrer = await getUserByReferralCode(input.referralCode);
    if (referrer && referrer.id !== user.id) {
      referrerId = referrer.id;
    }
  }

  // Seat validation + reservation insert run inside a single transaction
  // with the trip row locked (SELECT ... FOR UPDATE), so two concurrent
  // requests for the last seat can't both read "1 remaining" and both
  // succeed — the second waits for the lock and re-validates against
  // the first's already-committed seat count.
  const reservationId = await reserveSeatsWithLock(input.tripId, async ({ trip: lockedTrip, reservations: tripReservations, insertReservation, incrementCount }) => {
    const policy = getPolicy(lockedTrip.theme);

    const reserveCheck = policy.canReserve(lockedTrip, tripReservations, user);
    if (!reserveCheck.ok) {
      throw new TRPCError({ code: "BAD_REQUEST", message: reserveCheck.reason });
    }
    if (input.seats > policy.availability(lockedTrip, tripReservations).remaining) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "좌석이 부족합니다." });
    }

    const id = await insertReservation({
      userId: user.id,
      boardingPointId: input.boardingPointId,
      seats: input.seats,
      pointsUsed: input.pointsUsed,
      passengerName: input.passengerName,
      passengerPhone: input.passengerPhone,
      passengerEmail: input.passengerEmail,
      referralCode: input.referralCode,
    });
    await incrementCount(input.seats);
    return id;
  });

  await attachPayment(reservationId);

  await notifyTrip(
    input.tripId,
    "reservationConfirmed",
    { passengerName: input.passengerName, seats: input.seats, departureAt: trip.departureAt },
    [user.id]
  ).catch((error) => console.warn("[finalizeReservation] notifyTrip failed:", error));

  // Auto-confirm if this reservation reached minCount
  await maybeConfirmTrip(input.tripId);

  // Deduct points used
  if (input.pointsUsed > 0) {
    await addPoints(user.id, -input.pointsUsed, "usage", "예약 포인트 사용", String(reservationId));
  }

  // Referral points — once per referrer/referee pair, ever (including
  // pairs whose original referral was later cancelled), so a reserve →
  // cancel → reserve loop with the same code can't re-earn the bonus.
  if (referrerId) {
    const existingReferral = await getReferralByPair(referrerId, user.id);
    if (!existingReferral) {
      await createReferral({
        referrerId,
        refereeId: user.id,
        reservationId,
        status: "completed",
      });
      await addPoints(referrerId, 2000, "referral_earn", "친구 초대 적립", String(reservationId));
      await addPoints(user.id, 1000, "referral_earn", "초대 코드 사용 적립", String(reservationId));
    }
  }

  return reservationId;
}
