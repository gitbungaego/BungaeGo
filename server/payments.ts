import { Payment, PaymentCancelReason, PaymentItem, PaymentItemType, Trip } from "../drizzle/schema";
import { evaluateCancellation } from "@shared/cancellationPolicy";
import {
  addPoints,
  createPaymentWithItems,
  getLatestPaymentByReservationId,
  getPaymentItemsByPaymentId,
  getReservationsByTripId,
  updatePaymentStatus,
} from "./db";
import { cancelTossPayment } from "./toss";

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
