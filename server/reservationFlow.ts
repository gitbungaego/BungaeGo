import { TRPCError } from "@trpc/server";
import { isCreatedAfterOwnD5 } from "@shared/cancellationPolicy";
import type { User } from "../drizzle/schema";
import {
  addPoints,
  confirmTripIfCollecting,
  createReferral,
  createRideRequest,
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
export type TossOrderContext =
  | ({ kind: "reservation"; userId: number } & ReservationOrderInput)
  | ({ kind: "rideRequest"; userId: number } & RideRequestOrderInput);

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

// ─── Shared ride-request creation flow (track B, auto-match) ──────────────────
export interface RideRequestOrderInput {
  eventId: number;
  originAddress?: string;
  originLat: string;
  originLng: string;
  /** epoch ms */
  targetArrivalAt: number;
  seats: number;
  passengerName: string;
  passengerPhone: string;
  passengerEmail?: string;
  pointsUsed: number;
  referralCode?: string;
}

/**
 * 자동매칭 참가 신청 생성. mock 경로(rideRequests.create)와 Toss confirm
 * 경로가 공유한다. 결제 금액은 항상 서버가 이벤트 상한가(autoMatchPricePerSeat)
 * 기준으로 계산하며, `attachPayment`는 신청 insert 직후(포인트/추천 처리 전)
 * 실행된다 (toss: 결제 레코드에 rideRequestId 연결).
 */
export async function finalizeRideRequest(
  user: User,
  input: RideRequestOrderInput,
  paymentMethod: string,
  attachPayment?: (requestId: number) => Promise<void>
): Promise<number> {
  const event = await getEventById(input.eventId);
  if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "이벤트를 찾을 수 없습니다." });
  if (!event.autoMatchEnabled) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "이 이벤트는 자동 배차를 지원하지 않습니다." });
  }
  if (event.matchingFrozenAt) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "이미 배차가 확정된 이벤트입니다." });
  }
  if (!event.autoMatchPricePerSeat) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "이벤트 가격 설정이 없습니다." });
  }

  // Price is always computed server-side from the event's fixed price,
  // never trusted from the client, to prevent price tampering.
  const fareAmount = event.autoMatchPricePerSeat * input.seats;
  validatePointsUsage(input.pointsUsed, user.pointsBalance, fareAmount);
  const totalAmount = fareAmount - input.pointsUsed;

  let referrerId: number | undefined;
  if (input.referralCode) {
    const referrer = await getUserByReferralCode(input.referralCode);
    if (referrer && referrer.id !== user.id) {
      referrerId = referrer.id;
    }
  }

  const requestId = await createRideRequest({
    eventId: input.eventId,
    userId: user.id,
    originAddress: input.originAddress,
    originLat: input.originLat,
    originLng: input.originLng,
    targetArrivalAt: new Date(input.targetArrivalAt),
    seats: input.seats,
    totalAmount,
    pointsUsed: input.pointsUsed,
    passengerName: input.passengerName,
    passengerPhone: input.passengerPhone,
    passengerEmail: input.passengerEmail,
    referralCodeUsed: input.referralCode,
    paymentMethod,
    status: "pending",
  });

  if (attachPayment) await attachPayment(requestId);

  if (input.pointsUsed > 0) {
    await addPoints(user.id, -input.pointsUsed, "usage", "참가 신청 포인트 사용", String(requestId));
  }

  if (referrerId) {
    await createReferral({
      referrerId,
      refereeId: user.id,
      status: "completed",
    });
    await addPoints(referrerId, 2000, "referral_earn", "친구 초대 적립", String(requestId));
    await addPoints(user.id, 1000, "referral_earn", "초대 코드 사용 적립", String(requestId));
  }

  return requestId;
}
