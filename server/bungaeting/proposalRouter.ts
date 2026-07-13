import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { GENDER_MODES } from "../../drizzle/schema";
import {
  addPoints,
  claimBungaetingProposalReward,
  convertBungaetingProposalIfOpen,
  createBungaetingProposal,
  getBungaetingProposalById,
  getBungaetingProposalInterestBreakdown,
  getBungaetingProposalInterestedUsers,
  getEventById,
  getInterestedProposalIds,
  getOpenBungaetingProposals,
  getTripById,
  toggleBungaetingProposalInterest,
} from "../db";
import { router } from "../_core/trpc";
import { bungaetingAdminProcedure, bungaetingProcedure } from "./procedure";
import { sendSms } from "./sms";

// 제안자 보상: 비금전 포인트 (spec §3-5 "금전 보상 없음"). 상수로 고정.
export const PROPOSER_REWARD_POINTS = 5000;

export const proposalRouter = router({
  // 열린 제안 목록 — 이벤트 정보 + 성비 모드별 찜 집계 + 내 찜 여부.
  list: bungaetingProcedure.query(async ({ ctx }) => {
    const proposals = await getOpenBungaetingProposals();
    const mine = await getInterestedProposalIds(ctx.user.id);
    return Promise.all(
      proposals.map(async (p) => {
        const [event, breakdown] = await Promise.all([
          getEventById(p.eventId),
          getBungaetingProposalInterestBreakdown(p.id),
        ]);
        return {
          id: p.id,
          eventId: p.eventId,
          eventTitle: event?.title ?? "(삭제된 이벤트)",
          venue: event?.venue ?? null,
          proposedDate: p.proposedDate,
          notes: p.notes,
          interestTotal: breakdown.total,
          interestByMode: breakdown.byMode,
          myInterested: mine.has(p.id),
        };
      })
    );
  }),

  // 제안 생성 — 특정인 지목 요소 없음. "행사+날짜"만 (spec §3-5, §4).
  create: bungaetingProcedure
    .input(
      z.object({
        eventId: z.number(),
        proposedDate: z.number(), // epoch ms
        notes: z.string().max(300).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const event = await getEventById(input.eventId);
      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "이벤트를 찾을 수 없습니다." });
      const id = await createBungaetingProposal({
        eventId: input.eventId,
        proposerId: ctx.user.id,
        proposedDate: new Date(input.proposedDate),
        notes: input.notes,
        status: "open",
      });
      return { id };
    }),

  // 찜 멱등 토글 — "이 회차에 관심"(특정인과 함께가 아님, §4). 성비 모드는 선택.
  toggleInterest: bungaetingProcedure
    .input(
      z.object({
        proposalId: z.number(),
        genderModePreference: z.enum(GENDER_MODES).nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const proposal = await getBungaetingProposalById(input.proposalId);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "제안을 찾을 수 없습니다." });
      return toggleBungaetingProposalInterest(
        input.proposalId,
        ctx.user.id,
        input.genderModePreference ?? null
      );
    }),

  // 정식 회차 전환 — 관리자만. 이미 만든 번개팅 트립을 연결하고, 제안자에게 포인트
  // 보상(중복 방지)을 지급하며, 찜한 사용자에게 우선 결제 알림(SMS mock)을 보낸다.
  convert: bungaetingAdminProcedure
    .input(z.object({ proposalId: z.number(), tripId: z.number() }))
    .mutation(async ({ input }) => {
      const proposal = await getBungaetingProposalById(input.proposalId);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "제안을 찾을 수 없습니다." });

      const trip = await getTripById(input.tripId);
      if (!trip || trip.theme !== "bungaeting") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "연결할 번개팅 회차를 찾을 수 없습니다." });
      }

      // open일 때만 전환(멱등). 이미 전환/종료면 재알림·재지급을 막기 위해 여기서 멈춘다.
      const didConvert = await convertBungaetingProposalIfOpen(input.proposalId, input.tripId);
      if (!didConvert) {
        throw new TRPCError({ code: "CONFLICT", message: "이미 전환되었거나 종료된 제안입니다." });
      }

      // 제안자 보상 — rewardGrantedAt 조건부 UPDATE로 딱 한 번만. 재전환/재실행 이중지급 방지.
      const wonReward = await claimBungaetingProposalReward(input.proposalId);
      if (wonReward) {
        await addPoints(
          proposal.proposerId,
          PROPOSER_REWARD_POINTS,
          "admin_grant",
          "번개팅 회차 제안 보상",
          `bungaeting_proposal:${input.proposalId}`
        );
      }

      // 찜한 사용자에게 우선 결제 알림 (SMS mock = console.log).
      const interested = await getBungaetingProposalInterestedUsers(input.proposalId);
      const event = await getEventById(proposal.eventId);
      for (const u of interested) {
        if (!u.phone) continue;
        await sendSms(
          u.phone,
          `[번개팅] 관심 표시하신 '${event?.title ?? "회차"}'가 정식 회차로 열렸어요. 지금 우선 신청하세요.`
        ).catch((e) => console.warn("[proposal.convert] sms failed:", e));
      }

      return { success: true, rewardGranted: wonReward, notifiedCount: interested.filter((u) => u.phone).length };
    }),
});
