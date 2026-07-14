import { TRPCError } from "@trpc/server";
import { isWithinAgeBand } from "@shared/bungaeting/age";
import type { SeatAvailability, ThemeConfig } from "@shared/types";
import { GENDER_MODES, type Gender, type GenderMode, type Trip } from "../../drizzle/schema";
import type { ConfirmPolicy, ReserveCheck } from "../matching/confirmPolicy";
import { getBungaetingProfilesByUserIds } from "../db";
import type { ReservationWithPayment } from "../db";

// 번개팅 회차 themeConfig 서버 검증 (spec §7-1). 잘못된 설정으로 회차가 열리면
// 좌석/확정/자격 로직이 어긋나므로 생성·편집 시 관리자 입력을 여기서 검증한다.
export function validateBungaetingThemeConfig(cfg: ThemeConfig): void {
  if (!GENDER_MODES.includes(cfg.genderMode as GenderMode)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "성비 모드 값이 올바르지 않습니다." });
  }
  const bad = (m: string) => { throw new TRPCError({ code: "BAD_REQUEST", message: m }); };

  if (cfg.genderMode === "half") {
    if (!cfg.genderCap || cfg.genderCap.M <= 0 || cfg.genderCap.F <= 0) {
      bad("반반 모드는 남/여 정원(genderCap)이 각각 1 이상이어야 합니다.");
    }
    const minM = cfg.genderMin?.M ?? 0;
    const minF = cfg.genderMin?.F ?? 0;
    if (minM < 0 || minF < 0) bad("성별 최소 인원은 0 이상이어야 합니다.");
    if (minM > cfg.genderCap!.M || minF > cfg.genderCap!.F) {
      bad("성별 최소 인원은 해당 성별 정원을 초과할 수 없습니다.");
    }
  }

  const { ageMin, ageMax } = cfg;
  if (ageMin != null && (ageMin < 0 || ageMin > 120)) bad("나이 하한이 올바르지 않습니다.");
  if (ageMax != null && (ageMax < 0 || ageMax > 120)) bad("나이 상한이 올바르지 않습니다.");
  if (ageMin != null && ageMax != null && ageMin > ageMax) bad("나이 하한이 상한보다 클 수 없습니다.");
}

// 관리자/사용자 입력(flat 필드)을 themeConfig로 조립 + 검증. 회차 생성·편집이 공유한다.
// 반반이 아니면 genderCap/genderMin은 무의미하므로 생략(트립 maxCount/minCount 사용).
export interface BungaetingConfigFields {
  genderMode: GenderMode;
  genderCapM?: number;
  genderCapF?: number;
  genderMinM?: number;
  genderMinF?: number;
  ageMin?: number | null;
  ageMax?: number | null;
  feeAmount?: number;
}
export function buildThemeConfig(i: BungaetingConfigFields): ThemeConfig {
  const cfg: ThemeConfig = {
    genderMode: i.genderMode,
    genderCap: i.genderMode === "half" ? { M: i.genderCapM ?? 0, F: i.genderCapF ?? 0 } : undefined,
    genderMin: i.genderMode === "half" ? { M: i.genderMinM ?? 0, F: i.genderMinF ?? 0 } : undefined,
    ageMin: i.ageMin ?? null,
    ageMax: i.ageMax ?? null,
    feeAmount: i.feeAmount,
  };
  validateBungaetingThemeConfig(cfg);
  return cfg;
}

// trips.themeConfig(JSON)를 번개팅 설정으로 안전하게 파싱. 누락 필드는 기본값.
export function parseBungaetingConfig(trip: Trip): ThemeConfig {
  const cfg = (trip.themeConfig ?? {}) as Partial<ThemeConfig>;
  return {
    genderMode: cfg.genderMode ?? "any",
    genderCap: cfg.genderCap,
    genderMin: cfg.genderMin,
    ageMin: cfg.ageMin ?? null,
    ageMax: cfg.ageMax ?? null,
    feeAmount: cfg.feeAmount,
  };
}

function activeReservations(reservations: ReservationWithPayment[]): ReservationWithPayment[] {
  return reservations.filter((r) => r.status !== "cancelled");
}

// 예약자들의 성별별 좌석 합계 (반반 모드 정원 계산용). genderByUserId에 없는
// userId(프로필 없음)는 어느 쪽에도 안 세지므로 정원 소진에서 제외된다.
function seatsByGender(
  reservations: ReservationWithPayment[],
  genderByUserId: Map<number, Gender>
): { M: number; F: number } {
  const acc = { M: 0, F: 0 };
  for (const r of activeReservations(reservations)) {
    const g = genderByUserId.get(r.userId);
    if (g === "M") acc.M += r.seats;
    else if (g === "F") acc.F += r.seats;
  }
  return acc;
}

// 락 안에서 예약자 userId → 성별 맵을 만든다. 프로필은 이 트랜잭션에서 바뀌지 않고,
// 트립 행을 FOR UPDATE로 잡고 있어 이 트립의 예약 집합이 고정된 상태라 pool read로 안전.
export async function buildGenderMap(
  reservations: ReservationWithPayment[]
): Promise<Map<number, Gender>> {
  const userIds = Array.from(new Set(reservations.map((r) => r.userId)));
  const profiles = await getBungaetingProfilesByUserIds(userIds);
  return new Map(profiles.map((p) => [p.userId, p.gender]));
}

export const BungaetingPolicy: ConfirmPolicy = {
  // D-5 확정 판정 (spec §2-2): 반반은 남/여 각각 최소인원, 전용은 해당 성별 최소인원.
  // genderByUserId가 필요하며, 스케줄러가 이를 넘긴다(step ③에서 연결).
  canConfirm(trip, reservations, ctx) {
    if (trip.status !== "collecting") return false;
    const cfg = parseBungaetingConfig(trip);
    const genderByUserId = ctx?.genderByUserId ?? new Map<number, Gender>();

    if (cfg.genderMode === "half") {
      const g = seatsByGender(reservations, genderByUserId);
      const minM = cfg.genderMin?.M ?? 0;
      const minF = cfg.genderMin?.F ?? 0;
      return g.M >= minM && g.F >= minF;
    }
    if (cfg.genderMode === "female_only") {
      return seatsByGender(reservations, genderByUserId).F >= trip.minCount;
    }
    if (cfg.genderMode === "male_only") {
      return seatsByGender(reservations, genderByUserId).M >= trip.minCount;
    }
    // 일반 모드: 성비 무관, 총 인원만.
    return activeReservations(reservations).reduce((s, r) => s + r.seats, 0) >= trip.minCount;
  },

  // 잔여석 표시 (spec §2-1, §5): 반반은 byGroup으로 "남 N·여 M" 분리, 나머지는 단일.
  availability(trip, reservations, ctx) {
    const cfg = parseBungaetingConfig(trip);
    const used = activeReservations(reservations).reduce((s, r) => s + r.seats, 0);

    if (cfg.genderMode === "half" && cfg.genderCap) {
      const g = seatsByGender(reservations, ctx?.genderByUserId ?? new Map());
      const total = cfg.genderCap.M + cfg.genderCap.F;
      return {
        total,
        remaining: Math.max(0, total - used),
        byGroup: {
          M: { cap: cfg.genderCap.M, remaining: Math.max(0, cfg.genderCap.M - g.M) },
          F: { cap: cfg.genderCap.F, remaining: Math.max(0, cfg.genderCap.F - g.F) },
        },
      } satisfies SeatAvailability;
    }
    return { total: trip.maxCount, remaining: Math.max(0, trip.maxCount - used) };
  },

  // 예약 자격 검증 3종 (spec §3-5, 확인 포인트 3):
  //   (a) 번개팅 프로필 존재 + 본인인증 완료
  //   (b) 신청자 성별이 회차 성비 모드에 부합
  //   (c) 만 나이가 나이 밴드 내 (판정 기준일 = 탑승일, ctx.applicant에 미리 계산)
  canReserve(trip, _reservations, _user, ctx): ReserveCheck {
    if (trip.status === "cancelled") {
      return { ok: false, reason: "취소된 셔틀입니다.", code: "BAD_REQUEST" };
    }
    const cfg = parseBungaetingConfig(trip);
    const profile = ctx?.applicant?.profile;

    // (a) 프로필 + 인증
    if (!profile || !profile.verifiedAt) {
      return { ok: false, reason: "번개팅 본인인증 프로필이 필요합니다.", code: "FORBIDDEN" };
    }
    if (profile.status !== "active") {
      return { ok: false, reason: "이용이 제한된 프로필입니다.", code: "FORBIDDEN" };
    }

    // (b) 성별 ↔ 성비 모드
    if (cfg.genderMode === "female_only" && profile.gender !== "F") {
      return { ok: false, reason: "여성 전용 회차입니다.", code: "FORBIDDEN" };
    }
    if (cfg.genderMode === "male_only" && profile.gender !== "M") {
      return { ok: false, reason: "남성 전용 회차입니다.", code: "FORBIDDEN" };
    }

    // (c) 만 나이 ↔ 나이 밴드 (탑승일 기준)
    const age = ctx?.applicant?.ageAtDeparture;
    if (age == null || !isWithinAgeBand(age, cfg.ageMin, cfg.ageMax)) {
      return { ok: false, reason: "이 회차의 나이대에 해당하지 않습니다.", code: "FORBIDDEN" };
    }

    return { ok: true };
  },

  // 신청자 기준 잔여석: 반반 모드는 신청자 성별의 잔여석, 나머지는 총 잔여석.
  remainingForApplicant(trip, reservations, ctx) {
    const cfg = parseBungaetingConfig(trip);
    const avail = this.availability(trip, reservations, ctx);

    if (cfg.genderMode === "half" && avail.byGroup) {
      const gender = ctx?.applicant?.profile?.gender;
      if (gender === "M") return avail.byGroup.M?.remaining ?? 0;
      if (gender === "F") return avail.byGroup.F?.remaining ?? 0;
      return 0; // 성별 미상은 반반 모드에서 좌석을 배정하지 않는다.
    }
    return avail.remaining;
  },
};
