import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return {
    ...actual,
    getTripsByStatus: vi.fn(),
    getReservationsWithPaymentsByTripId: vi.fn(),
    getBungaetingProfilesByUserIds: vi.fn(),
    confirmTripIfCollecting: vi.fn(),
    cancelTripIfCollecting: vi.fn(),
    getEventById: vi.fn(),
  };
});

vi.mock("../notify/tripMessenger", () => ({
  notifyTrip: vi.fn().mockResolvedValue({ sentCount: 0, failedCount: 0 }),
}));

vi.mock("../payments", () => ({
  cancelReservationsForTrip: vi.fn().mockResolvedValue(undefined),
}));

import * as db from "../db";
import { cancelReservationsForTrip } from "../payments";
import { runTripConfirmOrCancelJudgment } from "./tripConfirmScheduler";
import { dMinusBoundaryUtc, evaluateCancellation } from "@shared/cancellationPolicy";
import type { ThemeConfig } from "@shared/types";
import type { BungaetingProfile, Gender, Trip } from "../../drizzle/schema";
import type { ReservationWithPayment } from "../db";

// 탑승일 2026-09-20 20:00 KST. D-5 판정 시점 이후로 now를 잡는다.
const DEPARTURE = new Date("2026-09-20T11:00:00.000Z");
const AFTER_D5 = new Date(dMinusBoundaryUtc(DEPARTURE, 5).getTime() + 60 * 60 * 1000);
// 정상 생성(자기 D-5 이전) — 스케줄러 판정 대상.
const CREATED_BEFORE_D5 = new Date("2026-08-01T00:00:00Z");

function trip(o: Partial<Trip>, cfg?: Partial<ThemeConfig>): Trip {
  return {
    id: 1, eventId: 1, mode: "bus", status: "collecting", cancelReason: null,
    minCount: 2, maxCount: 20, currentCount: 0, price: 40000, departureAt: DEPARTURE,
    returnAt: null, isRoundTrip: false, operatorName: null, operatorContact: null, notes: null,
    creatorId: null, sourceClusterId: null, theme: "standard", themeConfig: null,
    createdAt: CREATED_BEFORE_D5, updatedAt: CREATED_BEFORE_D5, ...o,
    ...(cfg ? { theme: "bungaeting", themeConfig: { genderMode: "any", ...cfg } as ThemeConfig } : {}),
  };
}

function res(id: number, userId: number, seats = 1): ReservationWithPayment {
  return {
    id, userId, tripId: 1, boardingPointId: null, seats, seatNo: null, pointsUsed: 0,
    passengerName: "T", passengerPhone: "010", passengerEmail: null, qrToken: null, referralCode: null,
    createdAt: new Date(), updatedAt: new Date(), status: "paid",
    totalAmount: 40000, paymentMethod: "mock", paymentId: null,
    paidAt: new Date(), cancelledAt: null, cancelReason: null, cancelNote: null,
  } as ReservationWithPayment;
}

function profileRow(userId: number, gender: Gender): BungaetingProfile {
  return {
    id: userId, userId, nickname: "N", photoUrl: null, bio: null, gender, birthDate: "1994-01-01",
    verifiedAt: new Date(), verificationProvider: "mock", tosAgreedAt: new Date(),
    status: "active", createdAt: new Date(), updatedAt: new Date(),
  };
}

// 반반 회차 남8·여N을 만들기 위한 예약 + 프로필 셋업 헬퍼.
function halfTripReservations(males: number, females: number) {
  const reservations: ReservationWithPayment[] = [];
  const profiles: BungaetingProfile[] = [];
  let uid = 1;
  for (let i = 0; i < males; i++, uid++) { reservations.push(res(uid, uid)); profiles.push(profileRow(uid, "M")); }
  for (let i = 0; i < females; i++, uid++) { reservations.push(res(uid, uid)); profiles.push(profileRow(uid, "F")); }
  return { reservations, profiles };
}

afterEach(() => {
  Object.values(db).forEach((f) => { if (vi.isMockFunction(f)) f.mockReset(); });
  vi.mocked(cancelReservationsForTrip).mockReset();
});

const HALF_CFG: Partial<ThemeConfig> = { genderMode: "half", genderCap: { M: 8, F: 8 }, genderMin: { M: 8, F: 8 } };

describe("D-5 스케줄러 — 번개팅 성비 판정", () => {
  it("반반 남8·여7 (여 미달) → gender_ratio_not_met 자동취소 + 환불", async () => {
    const t = trip({ id: 1, minCount: 16 }, HALF_CFG);
    const { reservations, profiles } = halfTripReservations(8, 7);
    vi.mocked(db.getTripsByStatus).mockResolvedValue([t]);
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue(reservations);
    vi.mocked(db.getBungaetingProfilesByUserIds).mockResolvedValue(profiles);
    vi.mocked(db.cancelTripIfCollecting).mockResolvedValue(true);
    vi.mocked(db.getEventById).mockResolvedValue({ title: "E" } as any);

    await runTripConfirmOrCancelJudgment(AFTER_D5);

    expect(db.cancelTripIfCollecting).toHaveBeenCalledWith(1, "gender_ratio_not_met");
    expect(db.confirmTripIfCollecting).not.toHaveBeenCalled();
    expect(cancelReservationsForTrip).toHaveBeenCalledOnce();
  });

  it("반반 남8·여8 → 확정", async () => {
    const t = trip({ id: 1, minCount: 16 }, HALF_CFG);
    const { reservations, profiles } = halfTripReservations(8, 8);
    vi.mocked(db.getTripsByStatus).mockResolvedValue([t]);
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue(reservations);
    vi.mocked(db.getBungaetingProfilesByUserIds).mockResolvedValue(profiles);
    vi.mocked(db.confirmTripIfCollecting).mockResolvedValue(true);
    vi.mocked(db.getEventById).mockResolvedValue({ title: "E" } as any);

    await runTripConfirmOrCancelJudgment(AFTER_D5);

    expect(db.confirmTripIfCollecting).toHaveBeenCalledWith(1);
    expect(db.cancelTripIfCollecting).not.toHaveBeenCalled();
  });

  it("여성 전용: 여성 minCount 미달 → gender_ratio_not_met 취소", async () => {
    const t = trip({ id: 1, minCount: 3 }, { genderMode: "female_only" });
    const { reservations, profiles } = halfTripReservations(0, 2); // 여 2 < 3
    vi.mocked(db.getTripsByStatus).mockResolvedValue([t]);
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue(reservations);
    vi.mocked(db.getBungaetingProfilesByUserIds).mockResolvedValue(profiles);
    vi.mocked(db.cancelTripIfCollecting).mockResolvedValue(true);
    vi.mocked(db.getEventById).mockResolvedValue({ title: "E" } as any);

    await runTripConfirmOrCancelJudgment(AFTER_D5);
    expect(db.cancelTripIfCollecting).toHaveBeenCalledWith(1, "gender_ratio_not_met");
  });
});

describe("D-5 스케줄러 — 표준 트립 회귀", () => {
  it("표준 minCount 충족 → 확정, 성별 맵 조회 안 함", async () => {
    const t = trip({ id: 2, minCount: 2 });
    vi.mocked(db.getTripsByStatus).mockResolvedValue([t]);
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([res(1, 1), res(2, 2)]);
    vi.mocked(db.confirmTripIfCollecting).mockResolvedValue(true);
    vi.mocked(db.getEventById).mockResolvedValue({ title: "E" } as any);

    await runTripConfirmOrCancelJudgment(AFTER_D5);

    expect(db.confirmTripIfCollecting).toHaveBeenCalledWith(2);
    // 표준 트립은 성별 맵을 조회하지 않는다 (회귀: 번개팅 분기 미진입).
    expect(db.getBungaetingProfilesByUserIds).not.toHaveBeenCalled();
  });

  it("표준 minCount 미달 → min_count_not_met 취소 (사유 무변경)", async () => {
    const t = trip({ id: 2, minCount: 5 });
    vi.mocked(db.getTripsByStatus).mockResolvedValue([t]);
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([res(1, 1)]);
    vi.mocked(db.cancelTripIfCollecting).mockResolvedValue(true);
    vi.mocked(db.getEventById).mockResolvedValue({ title: "E" } as any);

    await runTripConfirmOrCancelJudgment(AFTER_D5);
    expect(db.cancelTripIfCollecting).toHaveBeenCalledWith(2, "min_count_not_met");
  });
});

describe("D-5 경계 정합 — 확정 = 프로필 공개 = 환불불가 시작", () => {
  it("확정을 트리거하는 D-5 경계와 환불불가 시작 경계가 동일 인스턴트다", () => {
    const confirmBoundary = dMinusBoundaryUtc(DEPARTURE, 5);

    // 경계 직전(1ms 전): 아직 확정 판정 안 함 + 취소 가능(50% 수수료 구간).
    const justBefore = new Date(confirmBoundary.getTime() - 1);
    expect(justBefore.getTime() < confirmBoundary.getTime()).toBe(true);
    // 예약은 1시간 이전에 생성했다고 가정(즉시취소 예외 배제).
    const reservedLongAgo = new Date(confirmBoundary.getTime() - 10 * 24 * 3600 * 1000);
    expect(evaluateCancellation(DEPARTURE, reservedLongAgo, justBefore).allowed).toBe(true);

    // 경계 도달: 스케줄러가 확정/취소 판정을 시작(now >= boundary) + 취소 불가.
    expect(confirmBoundary.getTime() >= confirmBoundary.getTime()).toBe(true);
    expect(evaluateCancellation(DEPARTURE, reservedLongAgo, confirmBoundary).allowed).toBe(false);
    // 즉, 확정이 일어나는 그 순간부터 환불이 불가해진다 = 프로필 공개(확정 상태) 시작점.
  });
});

describe("D-5 스케줄러 — 표준·번개팅 같은 틱 정합", () => {
  it("한 틱에서 표준(확정)·번개팅(취소)이 각자 정책대로 판정, 상호 간섭 없음", async () => {
    const standard = trip({ id: 2, minCount: 2 });
    const bungaeting = trip({ id: 1, minCount: 16 }, HALF_CFG);
    const { reservations: btRes, profiles } = halfTripReservations(8, 7); // 여 미달 → 취소

    vi.mocked(db.getTripsByStatus).mockResolvedValue([standard, bungaeting]);
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockImplementation(async (tripId: number) =>
      tripId === 2 ? [res(1, 1), res(2, 2)] : btRes
    );
    vi.mocked(db.getBungaetingProfilesByUserIds).mockResolvedValue(profiles);
    vi.mocked(db.confirmTripIfCollecting).mockResolvedValue(true);
    vi.mocked(db.cancelTripIfCollecting).mockResolvedValue(true);
    vi.mocked(db.getEventById).mockResolvedValue({ title: "E" } as any);

    await runTripConfirmOrCancelJudgment(AFTER_D5);

    expect(db.confirmTripIfCollecting).toHaveBeenCalledWith(2); // 표준 확정
    expect(db.confirmTripIfCollecting).not.toHaveBeenCalledWith(1);
    expect(db.cancelTripIfCollecting).toHaveBeenCalledWith(1, "gender_ratio_not_met"); // 번개팅 취소
    expect(db.cancelTripIfCollecting).not.toHaveBeenCalledWith(2, expect.anything());
  });
});
