import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return {
    ...actual,
    getEventById: vi.fn(),
    getTripById: vi.fn(),
    getBungaetingProposalById: vi.fn(),
    createBungaetingProposal: vi.fn(),
    toggleBungaetingProposalInterest: vi.fn(),
    convertBungaetingProposalIfOpen: vi.fn(),
    claimBungaetingProposalReward: vi.fn(),
    getBungaetingProposalInterestedUsers: vi.fn(),
    addPoints: vi.fn(),
  };
});

import * as db from "../db";
import { appRouter } from "../routers";
import { PROPOSER_REWARD_POINTS } from "./proposalRouter";
import type { TrpcContext } from "../_core/context";
import type { BungaetingTripProposal, Trip } from "../../drizzle/schema";

function ctx(userId: number | null, role: "user" | "admin" = "user"): TrpcContext {
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

function proposal(o: Partial<BungaetingTripProposal> = {}): BungaetingTripProposal {
  return {
    id: 1, eventId: 10, proposerId: 5, proposedDate: new Date("2026-10-01T10:00:00Z"), notes: null,
    status: "open", convertedTripId: null, rewardGrantedAt: null,
    createdAt: new Date(), updatedAt: new Date(), ...o,
  };
}
function btTrip(): Trip {
  return {
    id: 77, eventId: 10, mode: "bus", status: "collecting", cancelReason: null, minCount: 2, maxCount: 16,
    currentCount: 0, price: 45000, departureAt: new Date("2026-10-01T09:00:00Z"), returnAt: null,
    isRoundTrip: false, operatorName: null, operatorContact: null, notes: null, creatorId: null,
    sourceClusterId: null, theme: "bungaeting", themeConfig: null, openChatUrl: null,
    createdAt: new Date(), updatedAt: new Date(),
  } as Trip;
}

beforeEach(() => { process.env.FEATURE_BUNGAETING = "true"; });
afterEach(() => {
  delete process.env.FEATURE_BUNGAETING;
  Object.values(db).forEach((f) => { if (vi.isMockFunction(f)) f.mockReset(); });
});

const admin = () => appRouter.createCaller(ctx(1, "admin"));
const user = (uid: number) => appRouter.createCaller(ctx(uid));

describe("proposals.convert — 관리자 + 보상 중복 방지", () => {
  it("일반 사용자는 전환 불가 → FORBIDDEN", async () => {
    await expect(user(2).bungaeting.proposals.convert({ proposalId: 1, tripId: 77 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("전환 성공 시 제안자에게 포인트 1회 지급 + 찜한 사용자 알림", async () => {
    vi.mocked(db.getBungaetingProposalById).mockResolvedValue(proposal());
    vi.mocked(db.getTripById).mockResolvedValue(btTrip());
    vi.mocked(db.convertBungaetingProposalIfOpen).mockResolvedValue(true);
    vi.mocked(db.claimBungaetingProposalReward).mockResolvedValue(true); // 보상 잠금 획득
    vi.mocked(db.getEventById).mockResolvedValue({ title: "E" } as any);
    vi.mocked(db.getBungaetingProposalInterestedUsers).mockResolvedValue([
      { userId: 2, phone: "010-1" }, { userId: 3, phone: null },
    ]);

    const r = await admin().bungaeting.proposals.convert({ proposalId: 1, tripId: 77 });
    expect(r).toMatchObject({ success: true, rewardGranted: true, notifiedCount: 1 });
    expect(db.addPoints).toHaveBeenCalledWith(5, PROPOSER_REWARD_POINTS, "admin_grant", expect.any(String), "bungaeting_proposal:1");
    expect(db.addPoints).toHaveBeenCalledTimes(1);
  });

  it("보상 잠금 실패(이미 지급됨)면 addPoints 미호출 — 이중 지급 방지", async () => {
    vi.mocked(db.getBungaetingProposalById).mockResolvedValue(proposal());
    vi.mocked(db.getTripById).mockResolvedValue(btTrip());
    vi.mocked(db.convertBungaetingProposalIfOpen).mockResolvedValue(true);
    vi.mocked(db.claimBungaetingProposalReward).mockResolvedValue(false); // 이미 지급됨
    vi.mocked(db.getEventById).mockResolvedValue({ title: "E" } as any);
    vi.mocked(db.getBungaetingProposalInterestedUsers).mockResolvedValue([]);

    const r = await admin().bungaeting.proposals.convert({ proposalId: 1, tripId: 77 });
    expect(r.rewardGranted).toBe(false);
    expect(db.addPoints).not.toHaveBeenCalled();
  });

  it("이미 전환된 제안 재전환 → CONFLICT, 보상/알림 미실행", async () => {
    vi.mocked(db.getBungaetingProposalById).mockResolvedValue(proposal({ status: "converted" }));
    vi.mocked(db.getTripById).mockResolvedValue(btTrip());
    vi.mocked(db.convertBungaetingProposalIfOpen).mockResolvedValue(false); // open 아님

    await expect(admin().bungaeting.proposals.convert({ proposalId: 1, tripId: 77 }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.claimBungaetingProposalReward).not.toHaveBeenCalled();
    expect(db.addPoints).not.toHaveBeenCalled();
  });

  it("번개팅 트립이 아니면 BAD_REQUEST", async () => {
    vi.mocked(db.getBungaetingProposalById).mockResolvedValue(proposal());
    vi.mocked(db.getTripById).mockResolvedValue({ ...btTrip(), theme: "standard" });
    await expect(admin().bungaeting.proposals.convert({ proposalId: 1, tripId: 77 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("proposals.create / toggleInterest", () => {
  it("제안 생성", async () => {
    vi.mocked(db.getEventById).mockResolvedValue({ id: 10, title: "E" } as any);
    vi.mocked(db.createBungaetingProposal).mockResolvedValue(9);
    const r = await user(5).bungaeting.proposals.create({ eventId: 10, proposedDate: Date.now(), notes: "주말 희망" });
    expect(r).toEqual({ id: 9 });
  });

  it("찜 토글은 db 토글로 위임", async () => {
    vi.mocked(db.getBungaetingProposalById).mockResolvedValue(proposal());
    vi.mocked(db.toggleBungaetingProposalInterest).mockResolvedValue({ interested: true, count: 3 });
    const r = await user(2).bungaeting.proposals.toggleInterest({ proposalId: 1, genderModePreference: "half" });
    expect(r).toEqual({ interested: true, count: 3 });
    expect(db.toggleBungaetingProposalInterest).toHaveBeenCalledWith(1, 2, "half");
  });

  it("비로그인 제안은 UNAUTHORIZED", async () => {
    await expect(appRouter.createCaller(ctx(null)).bungaeting.proposals.create({ eventId: 10, proposedDate: Date.now() }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
