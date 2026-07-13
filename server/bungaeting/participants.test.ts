import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return {
    ...actual,
    getTripById: vi.fn(),
    getReservationsWithPaymentsByTripId: vi.fn(),
    getBungaetingProfilesByUserIds: vi.fn(),
  };
});

import * as db from "../db";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import type { BungaetingProfile, Gender, Trip } from "../../drizzle/schema";
import type { ReservationWithPayment } from "../db";

function ctx(userId: number | null): TrpcContext {
  return {
    user: userId
      ? {
          id: userId, openId: `u-${userId}`, name: "실명유출되면안됨", email: null, loginMethod: "kakao",
          role: "user", status: "active", createdAt: new Date(), updatedAt: new Date(),
          lastSignedIn: new Date(), referralCode: `C${userId}`, pointsBalance: 0,
          phone: null, gender: null, birthDate: null, verifiedAt: null, verificationProvider: null,
        }
      : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

function trip(status: Trip["status"]): Trip {
  return {
    id: 1, eventId: 1, mode: "bus", status, cancelReason: null, minCount: 2, maxCount: 10,
    currentCount: 0, price: 40000, departureAt: new Date("2026-09-20T11:00:00Z"), returnAt: null,
    isRoundTrip: false, operatorName: null, operatorContact: null, notes: null, creatorId: null,
    sourceClusterId: null, theme: "bungaeting", themeConfig: { genderMode: "any" } as any,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

function res(userId: number, status: ReservationWithPayment["status"] = "paid"): ReservationWithPayment {
  return {
    id: userId * 10, userId, tripId: 1, boardingPointId: null, seats: 1, seatNo: null, pointsUsed: 0,
    passengerName: "P", passengerPhone: "010", passengerEmail: null, qrToken: null, referralCode: null,
    createdAt: new Date(), updatedAt: new Date(), status,
    totalAmount: 40000, paymentMethod: "mock", paymentId: null,
    paidAt: new Date(), cancelledAt: null, cancelReason: null, cancelNote: null,
  } as ReservationWithPayment;
}

function profile(userId: number, o: Partial<BungaetingProfile> = {}): BungaetingProfile {
  return {
    id: userId, userId, nickname: `닉${userId}`, photoUrl: `https://p/${userId}.jpg`, bio: `소개${userId}`,
    gender: (userId % 2 ? "M" : "F") as Gender, birthDate: "1994-01-01", verifiedAt: new Date(),
    verificationProvider: "mock", tosAgreedAt: new Date(), status: "active",
    createdAt: new Date(), updatedAt: new Date(), ...o,
  };
}

const call = (userId: number | null, tripId = 1) =>
  appRouter.createCaller(ctx(userId)).bungaeting.trips.participants({ tripId });

beforeEach(() => { process.env.FEATURE_BUNGAETING = "true"; });
afterEach(() => {
  delete process.env.FEATURE_BUNGAETING;
  Object.values(db).forEach((f) => { if (vi.isMockFunction(f)) f.mockReset(); });
});

describe("bungaeting.trips.participants — 3중 접근 제어", () => {
  it("비로그인 → UNAUTHORIZED (프로필 조회 자체를 안 함)", async () => {
    await expect(call(null)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(db.getBungaetingProfilesByUserIds).not.toHaveBeenCalled();
  });

  it("로그인했으나 미예약자 → FORBIDDEN", async () => {
    vi.mocked(db.getTripById).mockResolvedValue(trip("confirmed"));
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([res(1), res(2)]);
    // 요청자 99는 예약자 아님
    await expect(call(99)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.getBungaetingProfilesByUserIds).not.toHaveBeenCalled();
  });

  it("예약했으나 취소한 사람 → FORBIDDEN (유효 예약 아님)", async () => {
    vi.mocked(db.getTripById).mockResolvedValue(trip("confirmed"));
    // 유저 7은 cancelled, 유저 1은 paid
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([res(1), res(7, "cancelled")]);
    await expect(call(7)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("예약자이나 트립이 아직 collecting(미확정) → FORBIDDEN (공개 시점 전)", async () => {
    vi.mocked(db.getTripById).mockResolvedValue(trip("collecting"));
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([res(7), res(1)]);
    await expect(call(7)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.getBungaetingProfilesByUserIds).not.toHaveBeenCalled();
  });

  it("정상: 확정 트립의 유효 예약자 → 참가자 목록 반환", async () => {
    vi.mocked(db.getTripById).mockResolvedValue(trip("confirmed"));
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([res(7), res(1), res(2)]);
    vi.mocked(db.getBungaetingProfilesByUserIds).mockResolvedValue([profile(7), profile(1), profile(2)]);

    const list = await call(7);
    expect(list).toHaveLength(3);
    const me = list.find((p) => p.isMe);
    expect(me?.nickname).toBe("닉7");
    expect(list.filter((p) => p.isMe)).toHaveLength(1); // 본인은 정확히 하나 "나"로 구분
  });

  it("FEATURE_BUNGAETING OFF면 NOT_FOUND", async () => {
    delete process.env.FEATURE_BUNGAETING;
    await expect(call(7)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("bungaeting.trips.participants — 반환 데이터 최소화 (민감 필드 차단)", () => {
  it("nickname/photoUrl/bio/isMe/blinded 외 필드는 절대 없음", async () => {
    vi.mocked(db.getTripById).mockResolvedValue(trip("confirmed"));
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([res(7)]);
    vi.mocked(db.getBungaetingProfilesByUserIds).mockResolvedValue([profile(7)]);

    const [p] = await call(7);
    expect(Object.keys(p).sort()).toEqual(["bio", "blinded", "isMe", "nickname", "photoUrl"]);
    // 민감 필드가 새지 않는지 명시 확인
    const anyP = p as Record<string, unknown>;
    for (const banned of ["userId", "gender", "birthDate", "verifiedAt", "verificationProvider", "status", "tosAgreedAt", "email", "phone", "passengerName"]) {
      expect(anyP[banned]).toBeUndefined();
    }
  });
});

describe("bungaeting.trips.participants — blinded/restricted 상태 처리", () => {
  it("restricted 참가자는 목록에서 제외", async () => {
    vi.mocked(db.getTripById).mockResolvedValue(trip("confirmed"));
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([res(7), res(2)]);
    vi.mocked(db.getBungaetingProfilesByUserIds).mockResolvedValue([profile(7), profile(2, { status: "restricted" })]);

    const list = await call(7);
    expect(list).toHaveLength(1);
    expect(list[0].nickname).toBe("닉7");
  });

  it("blinded 참가자는 사진·소개 가려지고 blinded=true, 닉네임은 남음", async () => {
    vi.mocked(db.getTripById).mockResolvedValue(trip("confirmed"));
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([res(7), res(2)]);
    vi.mocked(db.getBungaetingProfilesByUserIds).mockResolvedValue([profile(7), profile(2, { status: "blinded" })]);

    const list = await call(7);
    const blinded = list.find((p) => p.nickname === "닉2");
    expect(blinded).toMatchObject({ blinded: true, photoUrl: null, bio: null });
  });
});
