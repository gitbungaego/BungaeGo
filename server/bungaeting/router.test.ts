import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return {
    ...actual,
    getBungaetingProfileByUserId: vi.fn(),
    createBungaetingProfile: vi.fn(),
    getBungaetingPreferenceByUserId: vi.fn(),
    upsertBungaetingPreference: vi.fn(),
    insertConsent: vi.fn(),
  };
});

import * as db from "../db";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import type { BungaetingProfile } from "../../drizzle/schema";

function ctx(userId: number | null): TrpcContext {
  return {
    user: userId
      ? {
          id: userId, openId: `u-${userId}`, name: "T", email: null, loginMethod: "kakao",
          role: "user", status: "active", createdAt: new Date(), updatedAt: new Date(),
          lastSignedIn: new Date(), referralCode: `C${userId}`, pointsBalance: 0,
          phone: null, gender: null, birthDate: null, verifiedAt: null, verificationProvider: null,
        }
      : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

function profile(o: Partial<BungaetingProfile> = {}): BungaetingProfile {
  return {
    id: 1, userId: 7, nickname: "테스터", photoUrl: null, bio: null,
    gender: "M", birthDate: "1995-05-05", verifiedAt: new Date(), verificationProvider: "mock",
    tosAgreedAt: new Date(), status: "active", createdAt: new Date(), updatedAt: new Date(), ...o,
  };
}

const ADULT = "1995-05-05";

beforeEach(() => {
  process.env.FEATURE_BUNGAETING = "true";
});

afterEach(() => {
  delete process.env.FEATURE_BUNGAETING;
  Object.values(db).forEach((f) => { if (vi.isMockFunction(f)) f.mockReset(); });
});

describe("bungaeting.profile.onboard", () => {
  it("mock 인증 후 프로필을 생성하고 id를 반환한다", async () => {
    vi.mocked(db.getBungaetingProfileByUserId).mockResolvedValue(undefined);
    vi.mocked(db.createBungaetingProfile).mockResolvedValue(42);

    const res = await appRouter.createCaller(ctx(7)).bungaeting.profile.onboard({
      nickname: "테스터", gender: "M", birthDate: ADULT, agreeTos: true,
    });

    expect(res).toEqual({ id: 42 });
    const inserted = vi.mocked(db.createBungaetingProfile).mock.calls[0][0];
    expect(inserted.userId).toBe(7);
    expect(inserted.verificationProvider).toBe("mock");
    expect(inserted.verifiedAt).toBeInstanceOf(Date);
    expect(inserted.birthDate).toBe(ADULT);
  });

  it("미성년자는 FORBIDDEN으로 거부한다", async () => {
    vi.mocked(db.getBungaetingProfileByUserId).mockResolvedValue(undefined);
    const minor = new Date();
    const birthDate = `${minor.getFullYear() - 15}-01-01`;

    await expect(
      appRouter.createCaller(ctx(7)).bungaeting.profile.onboard({
        nickname: "미성년", gender: "F", birthDate, agreeTos: true,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.createBungaetingProfile).not.toHaveBeenCalled();
  });

  it("이미 프로필이 있으면 CONFLICT", async () => {
    vi.mocked(db.getBungaetingProfileByUserId).mockResolvedValue(profile());
    await expect(
      appRouter.createCaller(ctx(7)).bungaeting.profile.onboard({
        nickname: "테스터", gender: "M", birthDate: ADULT, agreeTos: true,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("유효하지 않은 날짜는 BAD_REQUEST", async () => {
    vi.mocked(db.getBungaetingProfileByUserId).mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctx(7)).bungaeting.profile.onboard({
        nickname: "테스터", gender: "M", birthDate: "2026-13-40", agreeTos: true,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("비로그인은 UNAUTHORIZED", async () => {
    await expect(
      appRouter.createCaller(ctx(null)).bungaeting.profile.onboard({
        nickname: "테스터", gender: "M", birthDate: ADULT, agreeTos: true,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("FEATURE_BUNGAETING가 꺼져 있으면 NOT_FOUND (기능 게이트)", async () => {
    delete process.env.FEATURE_BUNGAETING;
    await expect(
      appRouter.createCaller(ctx(7)).bungaeting.profile.onboard({
        nickname: "테스터", gender: "M", birthDate: ADULT, agreeTos: true,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("bungaeting.profile.me", () => {
  it("프로필이 없으면 null", async () => {
    vi.mocked(db.getBungaetingProfileByUserId).mockResolvedValue(undefined);
    const res = await appRouter.createCaller(ctx(7)).bungaeting.profile.me();
    expect(res).toBeNull();
  });

  it("프로필이 있으면 그대로 반환", async () => {
    vi.mocked(db.getBungaetingProfileByUserId).mockResolvedValue(profile({ userId: 7 }));
    const res = await appRouter.createCaller(ctx(7)).bungaeting.profile.me();
    expect(res?.userId).toBe(7);
  });
});

describe("bungaeting.preferences.upsert", () => {
  it("ageMin > ageMax면 BAD_REQUEST", async () => {
    await expect(
      appRouter.createCaller(ctx(7)).bungaeting.preferences.upsert({
        preferredAgeMin: 40, preferredAgeMax: 30, smsOptIn: true,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.upsertBungaetingPreference).not.toHaveBeenCalled();
  });

  it("정상 입력은 upsert를 호출한다", async () => {
    vi.mocked(db.upsertBungaetingPreference).mockResolvedValue(undefined);
    const res = await appRouter.createCaller(ctx(7)).bungaeting.preferences.upsert({
      preferredGenderMode: "half", preferredAgeMin: 27, preferredAgeMax: 35, smsOptIn: true,
    });
    expect(res).toEqual({ success: true });
    expect(db.upsertBungaetingPreference).toHaveBeenCalledWith(7, expect.objectContaining({
      preferredGenderMode: "half", preferredAgeMin: 27, preferredAgeMax: 35, smsOptIn: true,
    }));
  });
});
