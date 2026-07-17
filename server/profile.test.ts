import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    updateUserName: vi.fn(),
    getEventRequestsByUserId: vi.fn(),
    getShuttleDemandsByUserId: vi.fn(),
  };
});

import * as db from "./db";
import { appRouter } from "./routers";
import { normalizeKakaoPhone } from "./_core/oauth";
import type { TrpcContext } from "./_core/context";

function ctx(userId: number | null): TrpcContext {
  return {
    user: userId
      ? { id: userId, openId: `u-${userId}`, name: "T", email: null, loginMethod: "kakao", role: "user",
          status: "active", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
          referralCode: `C${userId}`, pointsBalance: 0, phone: null, gender: null, birthDate: null,
          verifiedAt: null, verificationProvider: null, realName: null }
      : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

afterEach(() => {
  Object.values(db).forEach((f) => { if (vi.isMockFunction(f)) f.mockReset(); });
});

// 카카오 전화번호("+82 10-1234-5678") → 국내 표기 정규화
describe("normalizeKakaoPhone", () => {
  it("+82 형식을 0으로 시작하는 국내 표기로 변환", () => {
    expect(normalizeKakaoPhone("+82 10-1234-5678")).toBe("010-1234-5678");
    expect(normalizeKakaoPhone("+8210-1234-5678")).toBe("010-1234-5678");
  });

  it("이미 국내 표기이거나 다른 형식이면 그대로(20자 제한)", () => {
    expect(normalizeKakaoPhone("010-1234-5678")).toBe("010-1234-5678");
  });

  it("빈 값은 undefined", () => {
    expect(normalizeKakaoPhone(undefined)).toBeUndefined();
    expect(normalizeKakaoPhone("")).toBeUndefined();
  });
});

describe("auth.updateNickname — 닉네임 변경", () => {
  it("정상 변경", async () => {
    const r = await appRouter.createCaller(ctx(7)).auth.updateNickname({ name: "  번개러버  " });
    expect(r).toEqual({ success: true, name: "번개러버" });
    expect(db.updateUserName).toHaveBeenCalledWith(7, "번개러버");
  });

  it("빈 닉네임/비로그인 거부", async () => {
    await expect(appRouter.createCaller(ctx(7)).auth.updateNickname({ name: "   " })).rejects.toBeTruthy();
    await expect(appRouter.createCaller(ctx(null)).auth.updateNickname({ name: "닉" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(db.updateUserName).not.toHaveBeenCalled();
  });
});

describe("마이페이지 신청 내역 myList", () => {
  it("이벤트 신청/셔틀 신청 내역은 본인 것만 조회", async () => {
    vi.mocked(db.getEventRequestsByUserId).mockResolvedValue([]);
    vi.mocked(db.getShuttleDemandsByUserId).mockResolvedValue([]);
    await appRouter.createCaller(ctx(7)).eventRequests.myList();
    await appRouter.createCaller(ctx(7)).shuttleDemands.myList();
    expect(db.getEventRequestsByUserId).toHaveBeenCalledWith(7);
    expect(db.getShuttleDemandsByUserId).toHaveBeenCalledWith(7);
  });

  it("비로그인 → UNAUTHORIZED", async () => {
    await expect(appRouter.createCaller(ctx(null)).eventRequests.myList())
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(appRouter.createCaller(ctx(null)).shuttleDemands.myList())
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
