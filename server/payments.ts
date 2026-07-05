import { PaymentCancelReason, PaymentItem, PaymentItemType, Trip } from "../drizzle/schema";
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
  refundableAmount(item: PaymentItem, trip: Trip, now: Date): number;
}

export const FareRefundPolicy: RefundPolicy = {
  // 기존 규정: 시간 기반 위약금 없이 항상 전액 환불.
  refundableAmount(item) {
    return item.amount;
  },
};

const REFUND_POLICY_REGISTRY: Partial<Record<PaymentItemType, RefundPolicy>> = {
  fare: FareRefundPolicy,
  // theme_fee: 향후 ThemeFeeRefundPolicy 추가만 하면 됨.
};

export function computeRefundableAmount(
  item: PaymentItem,
  trip: Trip,
  now: Date,
  cancelReason: PaymentCancelReason
): number {
  if (cancelReason === "trip_not_confirmed") {
    // 트립이 확정되지 못해 취소되는 경우 아이템 타입과 무관하게 전액 환불.
    return item.amount;
  }
  const policy = REFUND_POLICY_REGISTRY[item.type];
  if (!policy) {
    throw new Error(`No refund policy registered for item type "${item.type}"`);
  }
  return policy.refundableAmount(item, trip, now);
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
      (sum, item) => sum + computeRefundableAmount(item, trip, now, "trip_not_confirmed"),
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
