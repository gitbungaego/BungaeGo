import { PaymentCancelReason, PaymentItem, PaymentItemType, Trip } from "../drizzle/schema";
import { evaluateCancellation } from "@shared/cancellationPolicy";
import {
  addPoints,
  createPaymentWithItems,
  getLatestPaymentByReservationId,
  getPaymentItemsByPaymentId,
  getReservationsByTripId,
  updatePaymentStatus,
} from "./db";

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

// ─── Trip cancellation cascade ────────────────────────────────────────────────
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
