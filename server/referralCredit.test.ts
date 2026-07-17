import { afterEach, describe, expect, it, vi } from "vitest";
import { computeReferralReward } from "@shared/referralReward";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getUserByReferralCode: vi.fn(),
    getUserById: vi.fn(),
    hasPaidReservationForEvent: vi.fn(),
    countRecentReferralEntriesByCode: vi.fn(),
    createReferralEntry: vi.fn(),
    getReferralEntriesByTripId: vi.fn(),
    settleReferralEntry: vi.fn(),
    getRewardConfigValues: vi.fn().mockResolvedValue({
      rateParticipant: 0.05,
      rateDefault: 0.02,
      capKrw: 5000,
      ttlDays: 365,
      dailyCodeEntryLimit: 20,
    }),
    getUsersWithExpiredPoints: vi.fn(),
    getUsersWithPointsExpiringBefore: vi.fn(),
    recordPointTransaction: vi.fn(),
  };
});

vi.mock("./bungaeting/sms", () => ({ sendSms: vi.fn().mockResolvedValue(undefined) }));

import * as db from "./db";
import { sendSms } from "./bungaeting/sms";
import {
  createEntryForReservation,
  runPointsExpiryBatch,
  settleTripReferrals,
  validateReferralCode,
} from "./referralCredit";
import type { Trip, User } from "../drizzle/schema";

const trip = { id: 10, eventId: 5 } as Trip;
function user(id: number, phone: string | null = null, status: "active" | "suspended" = "active"): User {
  return { id, phone, status, referralCode: `CODE${id}` } as User;
}

afterEach(() => {
  Object.values(db).forEach((f) => {
    if (vi.isMockFunction(f) && f !== db.getRewardConfigValues) f.mockReset();
  });
  vi.mocked(sendSms).mockClear();
});

// spec 체크리스트 1·4: floor + 상한
describe("computeReferralReward — 요율·내림·캡", () => {
  it("실결제액 43,000원 → 참가자 2,150 / 기본 860", () => {
    expect(computeReferralReward(43000, 0.05, 5000)).toBe(2150);
    expect(computeReferralReward(43000, 0.02, 5000)).toBe(860);
  });
  it("실결제액 120,000원 → 참가자 5,000(캡) / 기본 2,400", () => {
    expect(computeReferralReward(120000, 0.05, 5000)).toBe(5000);
    expect(computeReferralReward(120000, 0.02, 5000)).toBe(2400);
  });
  it("0원 결제·0 요율은 0", () => {
    expect(computeReferralReward(0, 0.05, 5000)).toBe(0);
    expect(computeReferralReward(1000, 0, 5000)).toBe(0);
  });
});

// spec 체크리스트 8: 셀프 입력 거부 + 존재/활성 검증
describe("validateReferralCode", () => {
  it("존재하지 않는 코드 거부", async () => {
    vi.mocked(db.getUserByReferralCode).mockResolvedValue(undefined);
    const r = await validateReferralCode("NOPE123", 1);
    expect(r.ok).toBe(false);
  });

  it("본인 코드 거부", async () => {
    vi.mocked(db.getUserByReferralCode).mockResolvedValue(user(1));
    const r = await validateReferralCode("CODE1", 1);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("본인") });
  });

  it("정지 계정 코드 거부, 활성은 허용", async () => {
    vi.mocked(db.getUserByReferralCode).mockResolvedValue(user(2, null, "suspended"));
    expect((await validateReferralCode("CODE2", 1)).ok).toBe(false);
    vi.mocked(db.getUserByReferralCode).mockResolvedValue(user(2));
    expect(await validateReferralCode("CODE2", 1)).toEqual({ ok: true, referrerUserId: 2 });
  });
});

// spec 체크리스트 2: 참가자/비참가 요율 스냅샷
describe("createEntryForReservation — 요율 판정·스냅샷", () => {
  it("동일 행사 결제 완료 추천인 → 5% 스냅샷", async () => {
    vi.mocked(db.getUserByReferralCode).mockResolvedValue(user(2));
    vi.mocked(db.hasPaidReservationForEvent).mockResolvedValue(true);
    vi.mocked(db.countRecentReferralEntriesByCode).mockResolvedValue(0);
    vi.mocked(db.createReferralEntry).mockResolvedValue(77);

    const id = await createEntryForReservation({
      trip, reservationId: 100, payer: user(1), code: "code2", source: "MANUAL", paidAmount: 43000,
    });
    expect(id).toBe(77);
    const saved = vi.mocked(db.createReferralEntry).mock.calls[0][0];
    expect(saved.appliedRate).toBe("0.050");
    expect(saved.referrerIsParticipant).toBe(true);
    expect(saved.paidAmount).toBe(43000);
    expect(saved.status).toBe("PENDING");
    expect(saved.code).toBe("CODE2"); // 대문자 정규화
  });

  it("비참가 추천인 → 2% 스냅샷", async () => {
    vi.mocked(db.getUserByReferralCode).mockResolvedValue(user(2));
    vi.mocked(db.hasPaidReservationForEvent).mockResolvedValue(false);
    vi.mocked(db.countRecentReferralEntriesByCode).mockResolvedValue(0);
    vi.mocked(db.createReferralEntry).mockResolvedValue(78);

    await createEntryForReservation({
      trip, reservationId: 101, payer: user(1), code: "CODE2", source: "LINK_PREFILL", paidAmount: 20000,
    });
    const saved = vi.mocked(db.createReferralEntry).mock.calls[0][0];
    expect(saved.appliedRate).toBe("0.020");
    expect(saved.referrerIsParticipant).toBe(false);
    expect(saved.source).toBe("LINK_PREFILL");
  });

  it("셀프/무효 코드는 entry를 만들지 않는다", async () => {
    vi.mocked(db.getUserByReferralCode).mockResolvedValue(user(1));
    const id = await createEntryForReservation({
      trip, reservationId: 102, payer: user(1), code: "CODE1", source: "MANUAL", paidAmount: 20000,
    });
    expect(id).toBeNull();
    expect(db.createReferralEntry).not.toHaveBeenCalled();
  });
});

// spec 체크리스트 11 + §7-4: 동일성·속도 제한 FLAGGED
describe("createEntryForReservation — 어뷰징 FLAG", () => {
  it("결제자·추천인 전화번호 동일 → FLAGGED", async () => {
    vi.mocked(db.getUserByReferralCode).mockResolvedValue(user(2, "010-1111-2222"));
    vi.mocked(db.hasPaidReservationForEvent).mockResolvedValue(false);
    vi.mocked(db.createReferralEntry).mockResolvedValue(79);

    await createEntryForReservation({
      trip, reservationId: 103, payer: user(1, "010-1111-2222"), code: "CODE2", source: "MANUAL", paidAmount: 20000,
    });
    const saved = vi.mocked(db.createReferralEntry).mock.calls[0][0];
    expect(saved.status).toBe("FLAGGED");
    expect(saved.flagReason).toContain("전화번호");
  });

  it("동일 코드 일일 한도 초과 → FLAGGED", async () => {
    vi.mocked(db.getUserByReferralCode).mockResolvedValue(user(2));
    vi.mocked(db.hasPaidReservationForEvent).mockResolvedValue(false);
    vi.mocked(db.countRecentReferralEntriesByCode).mockResolvedValue(20);
    vi.mocked(db.createReferralEntry).mockResolvedValue(80);

    await createEntryForReservation({
      trip, reservationId: 104, payer: user(1), code: "CODE2", source: "MANUAL", paidAmount: 20000,
    });
    expect(vi.mocked(db.createReferralEntry).mock.calls[0][0].status).toBe("FLAGGED");
  });
});

// spec 체크리스트 1: 트립 완료 → PENDING 일괄 정산 + 알림
describe("settleTripReferrals", () => {
  it("PENDING 건을 정산하고 적립 시 SMS 알림", async () => {
    vi.mocked(db.getReferralEntriesByTripId).mockResolvedValue([
      { id: 1 } as any,
      { id: 2 } as any,
    ]);
    vi.mocked(db.settleReferralEntry)
      .mockResolvedValueOnce({ granted: true, amount: 2150, referrerUserId: 2 })
      .mockResolvedValueOnce({ granted: false });
    vi.mocked(db.getUserById).mockResolvedValue(user(2, "010-2222-3333"));

    await settleTripReferrals(10);
    expect(db.settleReferralEntry).toHaveBeenCalledTimes(2);
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSms).mock.calls[0][1]).toContain("2,150");
  });
});

// spec 체크리스트 10 + §6: 만료 배치
describe("runPointsExpiryBatch", () => {
  it("만료 잔액을 EXPIRE로 0 처리하고, D-30/D-7만 알림", async () => {
    const now = new Date("2026-07-17T03:00:00Z");
    vi.mocked(db.getUsersWithExpiredPoints).mockResolvedValue([
      { id: 1, pointsBalance: 3000, pointsExpiresAt: new Date("2026-07-01") } as any,
    ]);
    vi.mocked(db.recordPointTransaction).mockResolvedValue({ id: 1, balanceAfter: 0 });
    vi.mocked(db.getUsersWithPointsExpiringBefore).mockResolvedValue([
      // D-30 (now 기준 KST 30일 뒤) → 알림
      { id: 2, phone: "010-1", pointsBalance: 500, pointsExpiresAt: new Date(now.getTime() + 30 * 864e5) } as any,
      // D-15 → 알림 없음
      { id: 3, phone: "010-2", pointsBalance: 500, pointsExpiresAt: new Date(now.getTime() + 15 * 864e5) } as any,
      // D-7 → 알림
      { id: 4, phone: "010-3", pointsBalance: 500, pointsExpiresAt: new Date(now.getTime() + 7 * 864e5) } as any,
    ]);

    const result = await runPointsExpiryBatch(now);
    expect(result.expired).toBe(1);
    expect(db.recordPointTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, type: "EXPIRE", amount: -3000 })
    );
    expect(result.notified).toBe(2);
  });
});
