import type { SeatAvailability } from "@shared/types";
import type { Gender, Trip, User, BungaetingProfile } from "../../drizzle/schema";
import type { ReservationWithPayment } from "../db";
import { BungaetingPolicy } from "../bungaeting/policy";

export type { SeatAvailability };

// 정책에 넘기는 부가 컨텍스트. 표준 트립은 안 쓰고(undefined), 번개팅만 사용한다.
// 좌석 락 코드(reserveSeatsWithLock)는 무변경 — 성별 분기는 이 컨텍스트를 통해
// 정책 계층에서만 일어난다 (spec §2-1: "같은 트랜잭션 경로에서 분기").
export interface PolicyContext {
  // 예약자 userId → 성별 (반반 모드 성별 잔여석 계산용). 락 안에서 프로필로 채운다.
  genderByUserId?: Map<number, Gender>;
  // 신청자 자격 검증용 (canReserve 전용): 번개팅 프로필 + 탑승일 기준 만 나이.
  applicant?: { profile: BungaetingProfile | null; ageAtDeparture: number | null };
}

export interface ReserveCheck {
  ok: boolean;
  reason?: string;
  // 거부 시 에러 코드 (미지정 시 호출부가 BAD_REQUEST로 처리).
  code?: "BAD_REQUEST" | "FORBIDDEN";
}

export interface ConfirmPolicy {
  canConfirm(trip: Trip, reservations: ReservationWithPayment[], ctx?: PolicyContext): boolean;
  availability(trip: Trip, reservations: ReservationWithPayment[], ctx?: PolicyContext): SeatAvailability;
  canReserve(
    trip: Trip,
    reservations: ReservationWithPayment[],
    user: User,
    ctx?: PolicyContext
  ): ReserveCheck;
  // 이 신청자가 실제로 예약 가능한 잔여 좌석 수. 반반 모드는 신청자 성별 기준.
  remainingForApplicant(trip: Trip, reservations: ReservationWithPayment[], ctx?: PolicyContext): number;
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

  remainingForApplicant(trip, reservations) {
    return this.availability(trip, reservations).remaining;
  },
};

const CONFIRM_POLICY_REGISTRY: Record<string, ConfirmPolicy> = {
  standard: StandardPolicy,
  bungaeting: BungaetingPolicy,
};

export function getPolicy(theme: string): ConfirmPolicy {
  const policy = CONFIRM_POLICY_REGISTRY[theme];
  if (!policy) {
    throw new Error(`No confirm policy registered for theme "${theme}"`);
  }
  return policy;
}
