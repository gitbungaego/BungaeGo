import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return {
    ...actual,
    getEventById: vi.fn(),
    createTrip: vi.fn(),
  };
});

import * as db from "../db";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

function ctx(userId: number | null): TrpcContext {
  return {
    user: userId
      ? { id: userId, openId: `u-${userId}`, name: "N", email: null, loginMethod: "kakao", role: "user",
          status: "active", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
          referralCode: `C${userId}`, pointsBalance: 0, phone: null, gender: null, birthDate: null,
          verifiedAt: null, verificationProvider: null }
      : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}
const call = (userId: number | null, input: any) =>
  appRouter.createCaller(ctx(userId)).bungaeting.trips.create(input);

const base = {
  eventId: 1, departureAt: Date.now(), price: 45000, minCount: 12, maxCount: 16,
  genderMode: "half" as const, genderCapM: 8, genderCapF: 8, genderMinM: 6, genderMinF: 6,
  ageMin: 27, ageMax: 35, openChatUrl: "https://open.kakao.com/o/x",
};

beforeEach(() => { process.env.FEATURE_BUNGAETING = "true"; });
afterEach(() => {
  delete process.env.FEATURE_BUNGAETING;
  Object.values(db).forEach((f) => { if (vi.isMockFunction(f)) f.mockReset(); });
});

describe("bungaeting.trips.create — 셔틀 만들기 번개팅 토글 (로그인 사용자 누구나)", () => {
  it("일반 로그인 사용자가 번개팅 회차 생성 성공 (theme=bungaeting, creatorId=본인)", async () => {
    vi.mocked(db.getEventById).mockResolvedValue({ id: 1, title: "E" } as any);
    vi.mocked(db.createTrip).mockResolvedValue(77);

    const r = await call(9, base);
    expect(r).toEqual({ id: 77 });
    const inserted = vi.mocked(db.createTrip).mock.calls[0][0];
    expect(inserted.theme).toBe("bungaeting");
    expect(inserted.creatorId).toBe(9);
    expect(inserted.openChatUrl).toBe("https://open.kakao.com/o/x");
  });

  it("잘못된 themeConfig(반반 정원 0) → BAD_REQUEST, 미생성", async () => {
    vi.mocked(db.getEventById).mockResolvedValue({ id: 1 } as any);
    await expect(call(9, { ...base, genderCapM: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.createTrip).not.toHaveBeenCalled();
  });

  it("성별 최소인원 > 정원 → BAD_REQUEST", async () => {
    vi.mocked(db.getEventById).mockResolvedValue({ id: 1 } as any);
    await expect(call(9, { ...base, genderMinM: 9 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("나이 하한 > 상한 → BAD_REQUEST", async () => {
    vi.mocked(db.getEventById).mockResolvedValue({ id: 1 } as any);
    await expect(call(9, { ...base, ageMin: 40, ageMax: 30 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("없는 이벤트 → NOT_FOUND", async () => {
    vi.mocked(db.getEventById).mockResolvedValue(undefined);
    await expect(call(9, base)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("비로그인 → UNAUTHORIZED", async () => {
    await expect(call(null, base)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("FEATURE_BUNGAETING OFF면 NOT_FOUND (기능 게이트)", async () => {
    delete process.env.FEATURE_BUNGAETING;
    await expect(call(9, base)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("일반 모드는 genderCap/genderMin 없이 통과", async () => {
    vi.mocked(db.getEventById).mockResolvedValue({ id: 1 } as any);
    vi.mocked(db.createTrip).mockResolvedValue(78);
    const r = await call(9, { eventId: 1, departureAt: Date.now(), price: 30000, minCount: 4, maxCount: 20, genderMode: "any" });
    expect(r).toEqual({ id: 78 });
  });
});
