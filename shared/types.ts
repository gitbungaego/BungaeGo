/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

// trips.themeConfig(JSON 컬럼) 형태 — 번개팅 회차 옵션. trips에 새 컬럼을 추가하지
// 않고 이 JSON 하나로 성비 모드/성별 정원/나이 밴드/추가요금을 표현한다 (spec §2, §2-1).
import type { GenderMode } from "../drizzle/schema";

export type ThemeConfig = {
  // 성비 모드 (any=일반 / half=반반 / female_only / male_only).
  genderMode: GenderMode;
  // 반반(half) 모드 성별 정원. 나머지 모드는 trip.maxCount 단일 정원 사용.
  genderCap?: { M: number; F: number };
  // 반반 모드 D-5 확정 판정용 성별 최소인원. 전용 모드는 trip.minCount 사용.
  genderMin?: { M: number; F: number };
  // 나이 밴드(만 나이, 포함 구간). null이면 그 방향 무제한. 판정 기준일은 탑승일.
  ageMin?: number | null;
  ageMax?: number | null;
  // 일반 대비 추가 요금(원, 표시용). 실제 청구는 trip.price에 반영 (spec §1: +20,000).
  feeAmount?: number;
};

// Seat availability snapshot for a trip, produced by ConfirmPolicy
// (server/matching/confirmPolicy.ts). Also the payload shape for the
// future WebSocket seat-status event.
export interface SeatAvailability {
  total: number;
  remaining: number;
  byGroup?: Record<string, { cap: number; remaining: number }>;
}
