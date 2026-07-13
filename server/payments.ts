import { Payment, PaymentCancelReason, PaymentItem, PaymentItemType, RideRequest, Trip } from "../drizzle/schema";
import { evaluateCancellation } from "@shared/cancellationPolicy";
import {
  addPoints,
  createPaymentWithItems,
  decrementTripCount,
  getLatestPaymentByReservationId,
  getLatestPaymentByRideRequestId,
  getPaymentItemsByPaymentId,
  getReferralByReservationId,
  getReservationById,
  getReservationsByTripId,
  getRideRequestsByEventId,
  getTripById,
  updatePaymentStatus,
  updateReferralStatus,
  updateRideRequestStatus,
} from "./db";
import { cancelTossPayment } from "./toss";
import { TRPCError } from "@trpc/server";

// ─── Payment item builder ─────────────────────────────────────────────────────
export interface CreatePaymentItemInput {
  type: PaymentItemType;
  amount: number;
  label: string;
}

export function buildFareItems(input: { fareAmount: number; pointsUsed: number }): CreatePaymentItemInput[] {
  const items: CreatePaymentItemInput[] = [{ type: "fare", amount: input.fareAmount, label: "셔틀 요금" }];
  if (input.pointsUsed > 0) {
    items.push({ type: "discount", amount: -input.pointsUsed, label: "포인트 할인" });
  }
  return items;
}

// ─── Refund policy ────────────────────────────────────────────────────────────
export interface RefundPolicy {
  refundableAmount(item: PaymentItem, trip: Trip, reservationCreatedAt: Date, now: Date): number;
}

// Tiered cancellation fee schedule (see @shared/cancellationPolicy). Only the
// fare line is subject to the fee — points are never fee-affected (see
// DiscountRefundPolicy below), so this is the only place the fee percentage
// actually reduces a refund amount.
export const FareRefundPolicy: RefundPolicy = {
  refundableAmount(item, trip, reservationCreatedAt, now) {
    const decision = evaluateCancellation(trip.departureAt, reservationCreatedAt, now);
    // reservations.cancel already rejects the mutation before touching
    // payments when cancellation isn't allowed, so this branch is defensive
    // only (e.g. a future caller that forgets to check first).
    if (!decision.allowed) return 0;
    return Math.round(item.amount * (1 - decision.feeRate));
  },
};

// Points-funded discount is always refunded in full via a separate addPoints
// call, regardless of the fare cancellation fee tier — points aren't subject
// to the cancellation fee. This just keeps the per-item refund total (used
// for the informational cancelNote) consistent with that: the discount line
// is never reduced by the fare's fee.
export const DiscountRefundPolicy: RefundPolicy = {
  refundableAmount(item) {
    return item.amount;
  },
};

const REFUND_POLICY_REGISTRY: Partial<Record<PaymentItemType, RefundPolicy>> = {
  fare: FareRefundPolicy,
  discount: DiscountRefundPolicy,
  // theme_fee: 향후 ThemeFeeRefundPolicy 추가만 하면 됨.
};

export function computeRefundableAmount(
  item: PaymentItem,
  trip: Trip,
  reservationCreatedAt: Date,
  now: Date,
  cancelReason: PaymentCancelReason
): number {
  if (cancelReason === "trip_not_confirmed" || cancelReason === "admin") {
    // 트립 미확정 자동환불, 관리자 강제취소(운영자 귀책/불가항력) 모두
    // 아이템 타입 및 D-5 수수료 등급과 무관하게 전액 환불.
    return item.amount;
  }
  const policy = REFUND_POLICY_REGISTRY[item.type];
  if (!policy) {
    throw new Error(`No refund policy registered for item type "${item.type}"`);
  }
  return policy.refundableAmount(item, trip, reservationCreatedAt, now);
}

// ─── Toss refund bridge ───────────────────────────────────────────────────────
/**
 * method='toss'인 결제에 대해 환불액만큼 Toss 취소 API를 호출한다.
 * - refundTotal(아이템별 환불 정책 합계)은 discount 라인이 음수로 상쇄돼
 *   이미 "현금 환불액"이다 - 포인트 환불은 기존 내부 로직(addPoints)이
 *   따로 처리하며 Toss와 무관하다.
 * - 전액(= totalAmount)이면 cancelAmount를 생략해 전액취소, 아니면 부분취소.
 * - 멱등키는 결제/금액 조합으로 고정: 네트워크 오류 후 재시도가 이중
 *   환불이 되지 않는다. 이미 취소된 결제 재취소는 성공으로 간주된다
 *   (cancelTossPayment 내부에서 ALREADY_CANCELED_PAYMENT 흡수).
 * - mock 등 다른 결제수단은 no-op.
 */
export async function refundTossPaymentIfNeeded(
  payment: Payment,
  refundAmount: number,
  cancelReason: string
): Promise<void> {
  if (payment.method !== "toss" || refundAmount <= 0) return;
  if (!payment.tossPaymentKey) {
    throw new Error(`toss payment ${payment.id} has no paymentKey - cannot refund`);
  }
  await cancelTossPayment({
    paymentKey: payment.tossPaymentKey,
    cancelReason,
    cancelAmount: refundAmount >= payment.totalAmount ? undefined : refundAmount,
    idempotencyKey: `refund-${payment.id}-${refundAmount}`,
  });
}

// ─── Auto-match difference refund (track B) ──────────────────────────────────
/**
 * 상한가 선결제 신청이 최종가로 확정될 때 차액을 환불한다.
 * 차액 = (상한가 - 최종가) × seats. refundedAmount(누적 환불액) 기준으로
 * 부족분(delta)만 추가 환불하므로, 매칭 재계산으로 커밋이 다시 돌아도
 * 같은 목표액에 대해 이중 환불되지 않는다.
 *
 * 현금(토스 부분취소)으로 환불 가능한 만큼 먼저 취소하고, 포인트를 많이 써서
 * 현금 잔액이 차액보다 작은 경우 나머지는 포인트로 환불한다.
 */
export async function applyRideRequestDifferenceRefund(
  payment: Payment,
  opts: {
    userId: number;
    requestId: number;
    seats: number;
    capPricePerSeat: number;
    finalPricePerSeat: number;
  }
): Promise<void> {
  const targetRefund = Math.max(0, (opts.capPricePerSeat - opts.finalPricePerSeat) * opts.seats);
  if (targetRefund === 0) return; // 차액 0이면 스킵
  if (payment.method !== "toss" || payment.status !== "paid") return;

  const delta = targetRefund - payment.refundedAmount;
  if (delta <= 0) return; // 이미 목표액까지 환불됨 (재계산 멱등)

  const cashAvailable = payment.totalAmount - payment.refundedAmount;
  const cashRefund = Math.min(delta, Math.max(0, cashAvailable));

  if (cashRefund > 0) {
    if (!payment.tossPaymentKey) {
      throw new Error(`toss payment ${payment.id} has no paymentKey - cannot refund difference`);
    }
    await cancelTossPayment({
      paymentKey: payment.tossPaymentKey,
      cancelReason: "배차 확정 차액 환불",
      cancelAmount: cashRefund,
      idempotencyKey: `diff-${payment.id}-${targetRefund}`,
    });
  }

  const pointsRemainder = delta - cashRefund;
  if (pointsRemainder > 0) {
    await addPoints(opts.userId, pointsRemainder, "refund", "배차 확정 차액 포인트 환불", String(opts.requestId));
  }

  await updatePaymentStatus(payment.id, "paid", {
    refundedAmount: payment.refundedAmount + delta,
    cancelNote: `차액 환불 누적 ${payment.refundedAmount + delta}원 (확정가 ${opts.finalPricePerSeat}원/석)`,
  });
}

// ─── Unmatched ride-request refund (freeze / auto-freeze) ─────────────────────
export interface UnmatchedRefundResult {
  refundedCount: number;
  refundFailures: number;
}

/**
 * Refunds every still-unmatched (pending/clustered) ride request for an event
 * and marks it failed_refunded. Shared by the manual freeze procedure and the
 * D-7 auto-freeze scheduler, so both handle noise/failed-cluster riders and
 * never-clustered riders identically.
 *
 * Toss prepayments get their remaining balance cancelled in full; a failed
 * Toss cancel leaves that request/payment untouched (retriable) rather than
 * marking it refunded, and is counted in refundFailures. Points are refunded
 * via the internal ledger regardless of payment method.
 */
export async function refundUnmatchedRideRequests(
  eventId: number,
  cancelNoteLabel = "배차 동결 미매칭 환불"
): Promise<UnmatchedRefundResult> {
  const allRequests = await getRideRequestsByEventId(eventId);
  const unmatched = allRequests.filter(
    (r: RideRequest) => r.status === "pending" || r.status === "clustered"
  );

  let refundFailures = 0;
  for (const req of unmatched) {
    const payment = await getLatestPaymentByRideRequestId(req.id);
    if (payment && payment.status === "paid") {
      const remaining = payment.totalAmount - payment.refundedAmount;
      try {
        await refundTossPaymentIfNeeded(payment, remaining, cancelNoteLabel);
        await updatePaymentStatus(payment.id, "cancelled", {
          cancelledAt: new Date(),
          cancelReason: "trip_not_confirmed",
          cancelNote: `${cancelNoteLabel} (환불액 ${remaining}원)`,
          refundedAmount: payment.totalAmount,
        });
      } catch (error) {
        refundFailures++;
        console.error(`[refundUnmatchedRideRequests] toss refund failed for request ${req.id} (payment ${payment.id}):`, error);
        try {
          await updatePaymentStatus(payment.id, "paid", {
            cancelNote: `${cancelNoteLabel} 실패 - 수동 재시도 필요 (환불 예정액 ${remaining}원)`,
          });
        } catch (noteError) {
          console.error("[refundUnmatchedRideRequests] failed to record refund failure:", noteError);
        }
        continue; // leave request untouched (retriable), keep processing others
      }
    }

    await updateRideRequestStatus(req.id, "failed_refunded", { refundedAt: new Date() });
    if (req.pointsUsed > 0) {
      await addPoints(req.userId, req.pointsUsed, "refund", cancelNoteLabel, String(req.id));
    }
  }

  return { refundedCount: unmatched.length - refundFailures, refundFailures };
}

// ─── Trip cancellation cascade ────────────────────────────────────────────────
// D-5 minCount 미달 자동취소 등에서 호출. 예약별 개별 try-catch: 한 건의
// Toss 취소 실패가 나머지 예약 환불을 막지 않고, 실패 건은 결제를 paid로
// 남겨(재시도 가능) cancelNote에 실패 기록을 남긴다.
export async function cancelReservationsForTrip(trip: Trip): Promise<void> {
  const now = new Date();
  const tripReservations = await getReservationsByTripId(trip.id);

  for (const reservation of tripReservations) {
    const payment = await getLatestPaymentByReservationId(reservation.id);
    if (!payment || payment.status !== "paid") continue;

    const items = await getPaymentItemsByPaymentId(payment.id);
    const refundTotal = items.reduce(
      (sum, item) => sum + computeRefundableAmount(item, trip, reservation.createdAt, now, "trip_not_confirmed"),
      0
    );

    try {
      await refundTossPaymentIfNeeded(payment, refundTotal, "트립 미확정 자동 환불");
    } catch (error) {
      console.error(
        `[cancelReservationsForTrip] toss refund failed for reservation ${reservation.id} (payment ${payment.id}):`,
        error
      );
      // 재시도 가능하도록 paid 상태 유지 + 실패 기록. 다음 예약 처리는 계속.
      try {
        await updatePaymentStatus(payment.id, "paid", {
          cancelNote: `트립 미확정 자동 환불 실패 - 수동 재시도 필요 (환불 예정액 ${refundTotal}원)`,
        });
      } catch (noteError) {
        console.error("[cancelReservationsForTrip] failed to record refund failure:", noteError);
      }
      continue;
    }

    await updatePaymentStatus(payment.id, "cancelled", {
      cancelledAt: now,
      cancelReason: "trip_not_confirmed",
      cancelNote: `트립 미확정으로 자동 환불 (환불액 ${refundTotal}원)`,
    });

    if (reservation.pointsUsed > 0) {
      await addPoints(reservation.userId, reservation.pointsUsed, "refund", "트립 취소로 인한 포인트 환불", String(reservation.id));
    }
  }
}

// 관리자 단건 취소 — D-5 취소창을 우회해 항상 전액 환불(운영자 귀책/불가항력).
// reservations.adminCancel(개별 예약)과 번개팅 이용제한(restrict) 시 미확정 예약
// 정리가 공유한다 — 취소·환불 로직은 여기 한 곳뿐(§7: 번개팅 전용 환불 로직 금지).
export async function adminCancelReservation(
  reservationId: number,
  adminId: number,
  reason?: string
): Promise<void> {
  const res = await getReservationById(reservationId);
  if (!res) throw new TRPCError({ code: "NOT_FOUND" });
  if (res.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "이미 취소된 예약입니다." });

  const trip = await getTripById(res.tripId);
  if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "셔틀을 찾을 수 없습니다." });

  const now = new Date();
  const payment = await getLatestPaymentByReservationId(res.id);
  if (payment) {
    const items = await getPaymentItemsByPaymentId(payment.id);
    const refundTotal = items.reduce(
      (sum, item) => sum + computeRefundableAmount(item, trip, res.createdAt, now, "admin"),
      0
    );
    if (payment.status === "paid") {
      try {
        await refundTossPaymentIfNeeded(payment, refundTotal, "관리자 취소 전액 환불");
      } catch (error) {
        console.error(`[adminCancelReservation] toss refund failed for payment ${payment.id}:`, error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "토스 환불 처리에 실패했습니다. 잠시 후 다시 시도해주세요.",
        });
      }
    }
    await updatePaymentStatus(payment.id, "cancelled", {
      cancelledAt: now,
      cancelReason: "admin",
      cancelNote: `관리자(#${adminId}) 취소${reason ? `: ${reason}` : ""} (환불액 ${refundTotal}원)`,
    });
  }
  await decrementTripCount(res.tripId, res.seats);

  if (res.pointsUsed > 0) {
    await addPoints(res.userId, res.pointsUsed, "refund", "관리자 취소로 인한 포인트 환불", String(res.id));
  }

  const referral = await getReferralByReservationId(res.id);
  if (referral && referral.status === "completed") {
    await addPoints(referral.referrerId, -referral.referrerPoints, "usage", "예약 취소로 인한 추천 적립 회수", String(res.id));
    await addPoints(referral.refereeId, -referral.refereePoints, "usage", "예약 취소로 인한 추천 적립 회수", String(res.id));
    await updateReferralStatus(referral.id, "cancelled");
  }
}
