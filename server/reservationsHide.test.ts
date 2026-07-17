import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getReservationById: vi.fn(),
    hideReservation: vi.fn(),
  };
});

import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function ctx(userId: number | null): TrpcContext {
  return {
    user: userId
      ? { id: userId, openId: `u-${userId}`, name: "T", email: null, loginMethod: "kakao", role: "user",
          status: "active", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
          referralCode: `C${userId}`, pointsBalance: 0, pointsExpiresAt: null, phone: null, gender: null,
          birthDate: null, verifiedAt: null, verificationProvider: null, realName: null }
      : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

afterEach(() => {
  Object.values(db).forEach((f) => { if (vi.isMockFunction(f)) f.mockReset(); });
});

// 마이페이지 '내역 삭제' — 취소/환불된 예약만 소프트 숨김
describe("reservations.hide", () => {
  it("본인의 취소된 예약은 숨김 처리", async () => {
    vi.mocked(db.getReservationById).mockResolvedValue({ id: 5, userId: 7, status: "cancelled" } as any);
    const r = await appRouter.createCaller(ctx(7)).reservations.hide({ id: 5 });
    expect(r).toEqual({ success: true });
    expect(db.hideReservation).toHaveBeenCalledWith(5);
  });

  it("환불된 예약도 숨김 가능", async () => {
    vi.mocked(db.getReservationById).mockResolvedValue({ id: 6, userId: 7, status: "refunded" } as any);
    await appRouter.createCaller(ctx(7)).reservations.hide({ id: 6 });
    expect(db.hideReservation).toHaveBeenCalledWith(6);
  });

  it("결제 완료(활성) 예약은 거부", async () => {
    vi.mocked(db.getReservationById).mockResolvedValue({ id: 5, userId: 7, status: "paid" } as any);
    await expect(appRouter.createCaller(ctx(7)).reservations.hide({ id: 5 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.hideReservation).not.toHaveBeenCalled();
  });

  it("남의 예약은 FORBIDDEN, 비로그인은 UNAUTHORIZED", async () => {
    vi.mocked(db.getReservationById).mockResolvedValue({ id: 5, userId: 99, status: "cancelled" } as any);
    await expect(appRouter.createCaller(ctx(7)).reservations.hide({ id: 5 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(appRouter.createCaller(ctx(null)).reservations.hide({ id: 5 }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(db.hideReservation).not.toHaveBeenCalled();
  });
});
