import type { SeatAvailability } from "@shared/types";
import type { Trip, User } from "../../drizzle/schema";
import type { ReservationWithPayment } from "../db";

export type { SeatAvailability };

export interface ConfirmPolicy {
  canConfirm(trip: Trip, reservations: ReservationWithPayment[]): boolean;
  availability(trip: Trip, reservations: ReservationWithPayment[]): SeatAvailability;
  canReserve(
    trip: Trip,
    reservations: ReservationWithPayment[],
    user: User
  ): { ok: boolean; reason?: string };
}

function activeSeatCount(reservations: ReservationWithPayment[]): number {
  return reservations.filter((r) => r.status !== "cancelled").reduce((sum, r) => sum + r.seats, 0);
}

// 기존 확정 규정: 모집 중(collecting)인 트립이 minCount 이상 모이면 확정.
export const StandardPolicy: ConfirmPolicy = {
  canConfirm(trip, reservations) {
    return trip.status === "collecting" && activeSeatCount(reservations) >= trip.minCount;
  },

  availability(trip, reservations) {
    const used = activeSeatCount(reservations);
    return { total: trip.maxCount, remaining: Math.max(0, trip.maxCount - used) };
  },

  canReserve(trip) {
    if (trip.status === "cancelled") {
      return { ok: false, reason: "취소된 셔틀입니다." };
    }
    return { ok: true };
  },
};

const CONFIRM_POLICY_REGISTRY: Record<string, ConfirmPolicy> = {
  standard: StandardPolicy,
};

export function getPolicy(theme: string): ConfirmPolicy {
  const policy = CONFIRM_POLICY_REGISTRY[theme];
  if (!policy) {
    throw new Error(`No confirm policy registered for theme "${theme}"`);
  }
  return policy;
}
