import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return {
    ...actual,
    getTripById: vi.fn(),
    getBungaetingProfileByUserId: vi.fn(),
    getBungaetingProfilesByUserIds: vi.fn(),
    reserveSeatsWithLock: vi.fn(),
    getReservationsWithPaymentsByTripId: vi.fn(),
    addPoints: vi.fn(),
  };
});

vi.mock("../notify/tripMessenger", () => ({
  notifyTrip: vi.fn().mockResolvedValue({ sentCount: 0, failedCount: 0 }),
}));

import * as db from "../db";
import { finalizeReservation } from "../reservationFlow";
import type { ThemeConfig } from "@shared/types";
import type { BungaetingProfile, Gender, Trip, User } from "../../drizzle/schema";

// 탑승일 2026-09-20. 생일 2000-10-01 → 탑승일 기준 아직 만 25 (생일 전).
const DEPARTURE = new Date("2026-09-20T11:00:00.000Z");

function btTrip(cfg: Partial<ThemeConfig>): Trip {
  return {
    id: 1, eventId: 1, mode: "bus", status: "collecting", cancelReason: null,
    minCount: 100, maxCount: 10, currentCount: 0, price: 40000, departureAt: DEPARTURE,
    returnAt: null, isRoundTrip: false, operatorName: null, operatorContact: null, notes: null,
    creatorId: null, sourceClusterId: null, theme: "bungaeting",
    themeConfig: { genderMode: "any", ...cfg } as ThemeConfig,
    createdAt: new Date("2026-08-01T00:00:00Z"), updatedAt: new Date("2026-08-01T00:00:00Z"),
  };
}

function profile(gender: Gender, birthDate: string, o: Partial<BungaetingProfile> = {}): BungaetingProfile {
  return {
    id: 1, userId: 7, nickname: "N", photoUrl: null, bio: null, gender, birthDate,
    verifiedAt: new Date(), verificationProvider: "mock", tosAgreedAt: new Date(),
    status: "active", createdAt: new Date(), updatedAt: new Date(), ...o,
  };
}

const user = {
  id: 7, openId: "u7", name: "T", email: null, loginMethod: "kakao", role: "user",
  status: "active", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  referralCode: "C7", pointsBalance: 0, phone: null, gender: null, birthDate: null,
  verifiedAt: null, verificationProvider: null,
} as User;

const input = { tripId: 1, seats: 1, passengerName: "T", passengerPhone: "010", pointsUsed: 0 };
const attach = vi.fn().mockResolvedValue(undefined);

function armLock(lockedTrip: Trip, reservations: any[] = []) {
  vi.mocked(db.reserveSeatsWithLock).mockImplementation(async (_id, fn) =>
    fn({
      trip: lockedTrip as any,
      reservations,
      insertReservation: vi.fn().mockResolvedValue(999),
      incrementCount: vi.fn().mockResolvedValue(undefined),
    } as any)
  );
  vi.mocked(db.getBungaetingProfilesByUserIds).mockResolvedValue([]);
}

afterEach(() => {
  Object.values(db).forEach((f) => { if (vi.isMockFunction(f)) f.mockReset(); });
  attach.mockReset();
});

describe("finalizeReservation — 번개팅 예약 자격 검증 배선", () => {
  it("(a) 프로필 없으면 FORBIDDEN, 예약 미생성", async () => {
    const t = btTrip({});
    vi.mocked(db.getTripById).mockResolvedValue(t);
    vi.mocked(db.getBungaetingProfileByUserId).mockResolvedValue(undefined);
    armLock(t);

    await expect(finalizeReservation(user, input, attach)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(attach).not.toHaveBeenCalled();
  });

  it("(b) 여성 전용에 남성 프로필이면 FORBIDDEN", async () => {
    const t = btTrip({ genderMode: "female_only" });
    vi.mocked(db.getTripById).mockResolvedValue(t);
    vi.mocked(db.getBungaetingProfileByUserId).mockResolvedValue(profile("M", "1990-01-01"));
    armLock(t);

    await expect(finalizeReservation(user, input, attach)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("(c) 탑승일 기준 만 나이가 밴드 미만이면 FORBIDDEN (생일 전 경계)", async () => {
    // ageMin 26. 생일 2000-10-01, 탑승일 2026-09-20 → 아직 만 25 → 거부.
    const t = btTrip({ ageMin: 26, ageMax: 40 });
    vi.mocked(db.getTripById).mockResolvedValue(t);
    vi.mocked(db.getBungaetingProfileByUserId).mockResolvedValue(profile("M", "2000-10-01"));
    armLock(t);

    await expect(finalizeReservation(user, input, attach)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("자격 충족 시 예약 생성(attachPayment 호출)", async () => {
    const t = btTrip({ genderMode: "any", ageMin: 20, ageMax: 40 });
    vi.mocked(db.getTripById).mockResolvedValue(t);
    vi.mocked(db.getBungaetingProfileByUserId).mockResolvedValue(profile("M", "1994-01-01"));
    vi.mocked(db.getReservationsWithPaymentsByTripId).mockResolvedValue([]);
    armLock(t);

    const id = await finalizeReservation(user, input, attach);
    expect(id).toBe(999);
    expect(attach).toHaveBeenCalledWith(999);
  });
});
