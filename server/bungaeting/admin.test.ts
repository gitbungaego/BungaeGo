import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return {
    ...actual,
    createTrip: vi.fn(),
    getTripById: vi.fn(),
    updateTrip: vi.fn(),
    getAllBungaetingTrips: vi.fn(),
    getReservationsWithPaymentsByTripId: vi.fn(),
    getBungaetingProfilesByUserIds: vi.fn(),
    updateBungaetingProfile: vi.fn(),
    getUnconfirmedBungaetingReservationIdsByUser: vi.fn(),
    getBungaetingReportById: vi.fn(),
    resolveBungaetingReport: vi.fn(),
    getPendingBungaetingReports: vi.fn(),
    getBungaetingTripParticipantPhones: vi.fn(),
    getBungaetingSmsOptInPhones: vi.fn(),
  };
});

vi.mock("../payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../payments")>();
  return { ...actual, adminCancelReservation: vi.fn() };
});

import * as db from "../db";
import { adminCancelReservation } from "../payments";
import { appRouter } from "../routers";
import { validateBungaetingThemeConfig } from "./policy";
import type { TrpcContext } from "../_core/context";
import type { ThemeConfig } from "@shared/types";

function ctx(userId: number | null, role: "user" | "admin" = "admin"): TrpcContext {
  return {
    user: userId
      ? { id: userId, openId: `u-${userId}`, name: "N", email: null, loginMethod: "kakao", role,
          status: "active", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
          referralCode: `C${userId}`, pointsBalance: 0, phone: null, gender: null, birthDate: null,
          verifiedAt: null, verificationProvider: null }
      : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}
const admin = () => appRouter.createCaller(ctx(1, "admin"));
const user = () => appRouter.createCaller(ctx(2, "user"));

beforeEach(() => { process.env.FEATURE_BUNGAETING = "true"; });
afterEach(() => {
  delete process.env.FEATURE_BUNGAETING;
  Object.values(db).forEach((f) => { if (vi.isMockFunction(f)) f.mockReset(); });
  vi.mocked(adminCancelReservation).mockReset();
});

describe("validateBungaetingThemeConfig", () => {
  const base: ThemeConfig = { genderMode: "half", genderCap: { M: 8, F: 8 }, genderMin: { M: 6, F: 6 }, ageMin: 27, ageMax: 35 };
  it("정상 설정은 통과", () => { expect(() => validateBungaetingThemeConfig(base)).not.toThrow(); });
  it("반반인데 정원 0이면 거부", () => {
    expect(() => validateBungaetingThemeConfig({ ...base, genderCap: { M: 0, F: 8 } })).toThrow();
  });
  it("최소인원이 정원 초과면 거부", () => {
    expect(() => validateBungaetingThemeConfig({ ...base, genderMin: { M: 9, F: 6 } })).toThrow();
  });
  it("나이 하한 > 상한이면 거부", () => {
    expect(() => validateBungaetingThemeConfig({ ...base, ageMin: 40, ageMax: 30 })).toThrow();
  });
});

describe("bungaeting.admin.setProfileStatus / resolveReport — 이용제한 시 미확정 예약 취소", () => {
  it("restrict 시 미확정 예약만 adminCancelReservation으로 취소", async () => {
    vi.mocked(db.getUnconfirmedBungaetingReservationIdsByUser).mockResolvedValue([101, 102]);
    const r = await admin().bungaeting.admin.setProfileStatus({ userId: 5, status: "restricted" });
    expect(db.updateBungaetingProfile).toHaveBeenCalledWith(5, { status: "restricted" });
    expect(adminCancelReservation).toHaveBeenCalledTimes(2);
    expect(adminCancelReservation).toHaveBeenCalledWith(101, 1, "번개팅 이용제한");
    expect(r.cancelledReservations).toBe(2);
  });

  it("blinded 처리 시엔 예약을 취소하지 않는다", async () => {
    const r = await admin().bungaeting.admin.setProfileStatus({ userId: 5, status: "blinded" });
    expect(db.updateBungaetingProfile).toHaveBeenCalledWith(5, { status: "blinded" });
    expect(adminCancelReservation).not.toHaveBeenCalled();
    expect(r.cancelledReservations).toBe(0);
  });

  it("resolveReport blind → 프로필 blinded + 신고 reviewed_blinded", async () => {
    vi.mocked(db.getBungaetingReportById).mockResolvedValue({ id: 9, targetUserId: 5 } as any);
    await admin().bungaeting.admin.resolveReport({ reportId: 9, action: "blind" });
    expect(db.updateBungaetingProfile).toHaveBeenCalledWith(5, { status: "blinded" });
    expect(db.resolveBungaetingReport).toHaveBeenCalledWith(9, "reviewed_blinded", 1);
    expect(adminCancelReservation).not.toHaveBeenCalled();
  });

  it("resolveReport restrict → 이용제한 + 미확정 취소 + reviewed_restricted", async () => {
    vi.mocked(db.getBungaetingReportById).mockResolvedValue({ id: 9, targetUserId: 5 } as any);
    vi.mocked(db.getUnconfirmedBungaetingReservationIdsByUser).mockResolvedValue([201]);
    await admin().bungaeting.admin.resolveReport({ reportId: 9, action: "restrict" });
    expect(adminCancelReservation).toHaveBeenCalledWith(201, 1, "번개팅 이용제한");
    expect(db.resolveBungaetingReport).toHaveBeenCalledWith(9, "reviewed_restricted", 1);
  });
});

describe("bungaeting.admin.sendNotification — 성별 단독 타겟 없음(§4-5)", () => {
  it("target enum은 trip/optIn만 — 성별 값은 애초에 받지 않는다", async () => {
    // @ts-expect-error 스키마에 성별 타겟이 없음을 타입으로도 보장
    await expect(admin().bungaeting.admin.sendNotification({ target: "male", message: "x" }))
      .rejects.toBeTruthy();
  });

  it("optIn 대상에게 발송하고 userId 중복 제거", async () => {
    vi.mocked(db.getBungaetingSmsOptInPhones).mockResolvedValue([
      { userId: 1, phone: "010-1" }, { userId: 1, phone: "010-1" }, { userId: 2, phone: null }, { userId: 3, phone: "010-3" },
    ]);
    const r = await admin().bungaeting.admin.sendNotification({ target: "optIn", message: "회차 열렸어요" });
    expect(r.sentCount).toBe(2); // userId1(중복 1회), userId3. userId2는 전화없음
  });
});

describe("bungaeting.trips.reportParticipant — 참가자만 서로 신고", () => {
  it("비참가자 대상 신고는 BAD_REQUEST", async () => {
    vi.mocked(db.getTripById).mockResolvedValue({ id: 1, theme: "bungaeting", status: "confirmed" } as any);
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([
      { userId: 2, status: "paid", seats: 1 } as any,
    ]);
    await expect(user().bungaeting.trips.reportParticipant({ tripId: 1, targetUserId: 99 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
