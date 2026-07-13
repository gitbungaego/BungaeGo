import { describe, expect, it } from "vitest";
import { BungaetingPolicy, parseBungaetingConfig } from "./policy";
import type { PolicyContext } from "../matching/confirmPolicy";
import type { BungaetingProfile, Gender, Trip, User } from "../../drizzle/schema";
import type { ReservationWithPayment } from "../db";
import type { ThemeConfig } from "@shared/types";

// 탑승일 2026-09-20 20:00 KST.
const DEPARTURE = new Date("2026-09-20T11:00:00.000Z");

function trip(cfg: Partial<ThemeConfig>, o: Partial<Trip> = {}): Trip {
  return {
    id: 1, eventId: 1, mode: "bus", status: "collecting", cancelReason: null,
    minCount: 2, maxCount: 10, currentCount: 0, price: 40000, departureAt: DEPARTURE,
    returnAt: null, isRoundTrip: false, operatorName: null, operatorContact: null, notes: null,
    creatorId: null, sourceClusterId: null, theme: "bungaeting",
    themeConfig: { genderMode: "any", ...cfg } as ThemeConfig,
    createdAt: new Date("2026-08-01T00:00:00Z"), updatedAt: new Date("2026-08-01T00:00:00Z"), ...o,
  };
}

function res(id: number, userId: number, seats = 1, status: ReservationWithPayment["status"] = "paid"): ReservationWithPayment {
  return {
    id, userId, tripId: 1, boardingPointId: null, seats, seatNo: null, pointsUsed: 0,
    passengerName: "T", passengerPhone: "010", passengerEmail: null, qrToken: null, referralCode: null,
    createdAt: new Date(), updatedAt: new Date(), status,
    totalAmount: 40000, paymentMethod: "mock", paymentId: null,
    paidAt: new Date(), cancelledAt: null, cancelReason: null, cancelNote: null,
  } as ReservationWithPayment;
}

function profile(gender: Gender, o: Partial<BungaetingProfile> = {}): BungaetingProfile {
  return {
    id: 1, userId: 7, nickname: "N", photoUrl: null, bio: null, gender,
    birthDate: "1995-05-05", verifiedAt: new Date(), verificationProvider: "mock",
    tosAgreedAt: new Date(), status: "active", createdAt: new Date(), updatedAt: new Date(), ...o,
  };
}

const fakeUser = { id: 7 } as User;

function ctx(applicantProfile: BungaetingProfile | null, ageAtDeparture: number | null, genderByUserId?: Map<number, Gender>): PolicyContext {
  return { applicant: { profile: applicantProfile, ageAtDeparture }, genderByUserId };
}

describe("parseBungaetingConfig", () => {
  it("누락 필드를 기본값으로 채운다", () => {
    const cfg = parseBungaetingConfig(trip({}, { themeConfig: null }));
    expect(cfg.genderMode).toBe("any");
    expect(cfg.ageMin).toBeNull();
    expect(cfg.ageMax).toBeNull();
  });
});

describe("canReserve — 자격 검증 3종", () => {
  it("(a) 프로필이 없으면 FORBIDDEN", () => {
    const r = BungaetingPolicy.canReserve(trip({}), [], fakeUser, ctx(null, 30));
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("(a) 인증(verifiedAt) 없으면 FORBIDDEN", () => {
    const r = BungaetingPolicy.canReserve(trip({}), [], fakeUser, ctx(profile("M", { verifiedAt: null }), 30));
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("(b) 여성 전용에 남성은 FORBIDDEN", () => {
    const r = BungaetingPolicy.canReserve(trip({ genderMode: "female_only" }), [], fakeUser, ctx(profile("M"), 30));
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("(b) 남성 전용에 여성은 FORBIDDEN", () => {
    const r = BungaetingPolicy.canReserve(trip({ genderMode: "male_only" }), [], fakeUser, ctx(profile("F"), 30));
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("(b) 여성 전용에 여성은 통과", () => {
    const r = BungaetingPolicy.canReserve(trip({ genderMode: "female_only" }), [], fakeUser, ctx(profile("F"), 30));
    expect(r.ok).toBe(true);
  });

  it("(c) 나이 밴드 밖이면 FORBIDDEN", () => {
    const r = BungaetingPolicy.canReserve(trip({ ageMin: 27, ageMax: 35 }), [], fakeUser, ctx(profile("M"), 26));
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("(c) 나이 밴드 안이면 통과", () => {
    const r = BungaetingPolicy.canReserve(trip({ ageMin: 27, ageMax: 35 }), [], fakeUser, ctx(profile("M"), 30));
    expect(r.ok).toBe(true);
  });

  it("restricted 프로필은 FORBIDDEN", () => {
    const r = BungaetingPolicy.canReserve(trip({}), [], fakeUser, ctx(profile("M", { status: "restricted" }), 30));
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("availability — 반반 모드 byGroup", () => {
  it("남 1석 차면 남 잔여 0·여 잔여 그대로 (남 3·여 3 정원)", () => {
    const t = trip({ genderMode: "half", genderCap: { M: 3, F: 3 } });
    const gmap = new Map<number, Gender>([[10, "M"]]);
    const a = BungaetingPolicy.availability(t, [res(1, 10)], { genderByUserId: gmap });
    expect(a.byGroup?.M).toEqual({ cap: 3, remaining: 2 });
    expect(a.byGroup?.F).toEqual({ cap: 3, remaining: 3 });
    expect(a.total).toBe(6);
  });

  it("취소된 예약은 정원에서 빠진다", () => {
    const t = trip({ genderMode: "half", genderCap: { M: 1, F: 1 } });
    const gmap = new Map<number, Gender>([[10, "M"]]);
    const a = BungaetingPolicy.availability(t, [res(1, 10, 1, "cancelled")], { genderByUserId: gmap });
    expect(a.byGroup?.M.remaining).toBe(1);
  });

  it("일반 모드는 byGroup 없이 단일 잔여석", () => {
    const a = BungaetingPolicy.availability(trip({ genderMode: "any" }, { maxCount: 5 }), [res(1, 10)], {});
    expect(a.byGroup).toBeUndefined();
    expect(a.remaining).toBe(4);
  });
});

describe("remainingForApplicant — 신청자 성별 기준 잔여석", () => {
  it("반반 모드: 남성 신청자는 남 잔여석을 본다", () => {
    const t = trip({ genderMode: "half", genderCap: { M: 1, F: 1 } });
    const gmap = new Map<number, Gender>([[10, "M"]]); // 남 1석 이미 참
    const c = ctx(profile("M"), 30, gmap);
    expect(BungaetingPolicy.remainingForApplicant(t, [res(1, 10)], c)).toBe(0);
  });

  it("반반 모드: 여성 신청자는 여 잔여석을 본다 (남 참, 여 비어있음)", () => {
    const t = trip({ genderMode: "half", genderCap: { M: 1, F: 1 } });
    const gmap = new Map<number, Gender>([[10, "M"]]);
    const c = ctx(profile("F"), 30, gmap);
    expect(BungaetingPolicy.remainingForApplicant(t, [res(1, 10)], c)).toBe(1);
  });
});

describe("canConfirm — D-5 성비 판정", () => {
  it("반반: 남녀 각 최소인원 충족해야 확정", () => {
    const t = trip({ genderMode: "half", genderCap: { M: 3, F: 3 }, genderMin: { M: 2, F: 2 } });
    const gmap = new Map<number, Gender>([[1, "M"], [2, "M"], [3, "F"]]); // 남2 여1
    expect(BungaetingPolicy.canConfirm(t, [res(1, 1), res(2, 2), res(3, 3)], { genderByUserId: gmap })).toBe(false);
    const gmap2 = new Map<number, Gender>([[1, "M"], [2, "M"], [3, "F"], [4, "F"]]);
    expect(BungaetingPolicy.canConfirm(t, [res(1, 1), res(2, 2), res(3, 3), res(4, 4)], { genderByUserId: gmap2 })).toBe(true);
  });

  it("여성 전용: 여성 minCount 충족 시 확정", () => {
    const t = trip({ genderMode: "female_only" }, { minCount: 2 });
    const gmap = new Map<number, Gender>([[1, "F"], [2, "F"]]);
    expect(BungaetingPolicy.canConfirm(t, [res(1, 1), res(2, 2)], { genderByUserId: gmap })).toBe(true);
  });
});
