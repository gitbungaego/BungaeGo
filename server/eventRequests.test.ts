import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    createEventRequest: vi.fn(),
    getEventRequests: vi.fn(),
    getEventById: vi.fn(),
    upsertShuttleDemand: vi.fn(),
    getShuttleDemandStatus: vi.fn(),
  };
});

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function ctx(userId: number | null, role: "user" | "admin" = "user"): TrpcContext {
  return {
    user: userId
      ? { id: userId, openId: `u-${userId}`, name: "T", email: null, loginMethod: "kakao", role,
          status: "active", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
          referralCode: `C${userId}`, pointsBalance: 0, phone: null, gender: null, birthDate: null,
          verifiedAt: null, verificationProvider: null }
      : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

const validRequest = {
  category: "concert",
  title: "미등록 콘서트",
  startDate: "2026-10-01",
  endDate: "2026-10-02",
  destination: "부산 사직야구장",
  origin: "창원시청",
  arrivalPreference: "md_sale" as const,
  phone: "010-1234-5678",
  email: "test@example.com",
};

afterEach(() => {
  Object.values(db).forEach((f) => { if (vi.isMockFunction(f)) f.mockReset(); });
});

describe("eventRequests.create — 이벤트 만들기 신청", () => {
  it("정상 신청은 저장되고 id 반환", async () => {
    vi.mocked(db.createEventRequest).mockResolvedValue(11);
    const r = await appRouter.createCaller(ctx(7)).eventRequests.create(validRequest);
    expect(r).toEqual({ id: 11 });
    const saved = vi.mocked(db.createEventRequest).mock.calls[0][0];
    expect(saved.userId).toBe(7);
    expect(saved.status).toBe("pending");
    expect(saved.arrivalPreference).toBe("md_sale");
  });

  it("비로그인 → UNAUTHORIZED", async () => {
    await expect(appRouter.createCaller(ctx(null)).eventRequests.create(validRequest))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("잘못된 이메일/날짜 형식은 거부", async () => {
    await expect(appRouter.createCaller(ctx(7)).eventRequests.create({ ...validRequest, email: "not-an-email" }))
      .rejects.toBeTruthy();
    await expect(appRouter.createCaller(ctx(7)).eventRequests.create({ ...validRequest, startDate: "10/01/2026" }))
      .rejects.toBeTruthy();
    expect(db.createEventRequest).not.toHaveBeenCalled();
  });

  it("adminList는 관리자만", async () => {
    await expect(appRouter.createCaller(ctx(7)).eventRequests.adminList())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    vi.mocked(db.getEventRequests).mockResolvedValue([]);
    await expect(appRouter.createCaller(ctx(1, "admin")).eventRequests.adminList()).resolves.toEqual([]);
  });
});

describe("shuttleDemands — 희망 탑승지 수요", () => {
  it("upsert: 이벤트 확인 후 저장, 현황 반환", async () => {
    vi.mocked(db.getEventById).mockResolvedValue({ id: 5, title: "E" } as any);
    vi.mocked(db.upsertShuttleDemand).mockResolvedValue(undefined);
    vi.mocked(db.getShuttleDemandStatus).mockResolvedValue({ count: 3, mine: { stopLabel: "대전" } as any });

    const r = await appRouter.createCaller(ctx(7)).shuttleDemands.upsert({
      eventId: 5, area: "other", stopLabel: "대전", neighborhood: "둔산동",
    });
    expect(db.upsertShuttleDemand).toHaveBeenCalledWith(5, 7, { area: "other", stopLabel: "대전", neighborhood: "둔산동" });
    expect(r.count).toBe(3);
  });

  it("없는 이벤트는 NOT_FOUND", async () => {
    vi.mocked(db.getEventById).mockResolvedValue(undefined);
    await expect(appRouter.createCaller(ctx(7)).shuttleDemands.upsert({ eventId: 999, area: "capital", stopLabel: "강남역" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.upsertShuttleDemand).not.toHaveBeenCalled();
  });

  it("비로그인 upsert → UNAUTHORIZED, status는 공개(count만)", async () => {
    await expect(appRouter.createCaller(ctx(null)).shuttleDemands.upsert({ eventId: 5, area: "capital", stopLabel: "강남역" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    vi.mocked(db.getShuttleDemandStatus).mockResolvedValue({ count: 2, mine: null });
    const r = await appRouter.createCaller(ctx(null)).shuttleDemands.status({ eventId: 5 });
    expect(r).toEqual({ count: 2, mine: null });
  });
});
