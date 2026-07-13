import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { BUNGAETING_PROFILE_STATUSES, GENDER_MODES } from "../../drizzle/schema";
import type { ThemeConfig } from "@shared/types";
import {
  createTrip,
  getAllBungaetingTrips,
  getBungaetingReportById,
  getBungaetingSmsOptInPhones,
  getBungaetingTripParticipantPhones,
  getPendingBungaetingReports,
  getReservationsWithPaymentsByTripId,
  getTripById,
  getUnconfirmedBungaetingReservationIdsByUser,
  resolveBungaetingReport,
  updateBungaetingProfile,
  updateTrip,
} from "../db";
import { adminCancelReservation } from "../payments";
import { router } from "../_core/trpc";
import { bungaetingAdminProcedure } from "./procedure";
import { buildGenderMap, parseBungaetingConfig, validateBungaetingThemeConfig } from "./policy";
import { sendSms } from "./sms";

// 회차 옵션 입력(생성·편집 공용). 성비 모드/정원/최소인원/나이밴드/추가요금.
const configInput = {
  genderMode: z.enum(GENDER_MODES),
  genderCapM: z.number().int().min(0).optional(),
  genderCapF: z.number().int().min(0).optional(),
  genderMinM: z.number().int().min(0).optional(),
  genderMinF: z.number().int().min(0).optional(),
  ageMin: z.number().int().min(0).max(120).nullable().optional(),
  ageMax: z.number().int().min(0).max(120).nullable().optional(),
  feeAmount: z.number().int().min(0).optional(),
};

function buildThemeConfig(i: {
  genderMode: (typeof GENDER_MODES)[number];
  genderCapM?: number; genderCapF?: number; genderMinM?: number; genderMinF?: number;
  ageMin?: number | null; ageMax?: number | null; feeAmount?: number;
}): ThemeConfig {
  const cfg: ThemeConfig = {
    genderMode: i.genderMode,
    genderCap: i.genderMode === "half" ? { M: i.genderCapM ?? 0, F: i.genderCapF ?? 0 } : undefined,
    genderMin: i.genderMode === "half" ? { M: i.genderMinM ?? 0, F: i.genderMinF ?? 0 } : undefined,
    ageMin: i.ageMin ?? null,
    ageMax: i.ageMax ?? null,
    feeAmount: i.feeAmount,
  };
  validateBungaetingThemeConfig(cfg); // 서버 검증 (minM<=cap, ageMin<=ageMax 등)
  return cfg;
}

// 이용제한 공통 처리: 프로필 restricted + 미확정 회차 예약 취소(전액환불).
// 이미 확정된 회차는 유지(다른 참가자 피해 방지, spec §7-2). adminCancelReservation
// 재사용 — 번개팅 전용 환불 로직 없음.
async function restrictProfileAndCancelUnconfirmed(targetUserId: number, adminId: number): Promise<number> {
  await updateBungaetingProfile(targetUserId, { status: "restricted" });
  const ids = await getUnconfirmedBungaetingReservationIdsByUser(targetUserId);
  let cancelled = 0;
  for (const rid of ids) {
    try {
      await adminCancelReservation(rid, adminId, "번개팅 이용제한");
      cancelled++;
    } catch (error) {
      console.warn(`[bungaeting.admin] cancel reservation ${rid} failed:`, error);
    }
  }
  return cancelled;
}

export const bungaetingAdminRouter = router({
  // ── 회차 생성/편집 (성비 모드/나이밴드/openChatUrl) ─────────────────────────────
  createTrip: bungaetingAdminProcedure
    .input(
      z.object({
        eventId: z.number(),
        departureAt: z.number(),
        returnAt: z.number().optional(),
        price: z.number().int().min(0).max(1_000_000),
        minCount: z.number().int().min(1),
        maxCount: z.number().int().min(1),
        openChatUrl: z.string().max(500).optional(),
        notes: z.string().max(300).optional(),
        ...configInput,
      }).refine((d) => d.minCount <= d.maxCount, { message: "최소 인원이 최대 인원보다 클 수 없습니다.", path: ["minCount"] })
    )
    .mutation(async ({ input, ctx }) => {
      const themeConfig = buildThemeConfig(input);
      const id = await createTrip({
        eventId: input.eventId,
        mode: "bus",
        minCount: input.minCount,
        maxCount: input.maxCount,
        price: input.price,
        departureAt: new Date(input.departureAt),
        returnAt: input.returnAt ? new Date(input.returnAt) : undefined,
        isRoundTrip: !!input.returnAt,
        theme: "bungaeting",
        themeConfig,
        openChatUrl: input.openChatUrl,
        notes: input.notes,
        creatorId: ctx.user.id,
      });
      return { id };
    }),

  updateTrip: bungaetingAdminProcedure
    .input(
      z.object({
        tripId: z.number(),
        price: z.number().int().min(0).max(1_000_000).optional(),
        minCount: z.number().int().min(1).optional(),
        maxCount: z.number().int().min(1).optional(),
        openChatUrl: z.string().max(500).nullable().optional(),
        ...configInput,
      })
    )
    .mutation(async ({ input }) => {
      const trip = await getTripById(input.tripId);
      if (!trip || trip.theme !== "bungaeting") {
        throw new TRPCError({ code: "NOT_FOUND", message: "번개팅 회차를 찾을 수 없습니다." });
      }
      const themeConfig = buildThemeConfig(input);
      await updateTrip(input.tripId, {
        themeConfig,
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.minCount !== undefined ? { minCount: input.minCount } : {}),
        ...(input.maxCount !== undefined ? { maxCount: input.maxCount } : {}),
        ...(input.openChatUrl !== undefined ? { openChatUrl: input.openChatUrl } : {}),
      });
      return { success: true } as const;
    }),

  // ── 성비 모집 현황 (확정 전 남/여 현재 인원 vs minM/minF) ─────────────────────
  listTrips: bungaetingAdminProcedure.query(async () => {
    const trips = await getAllBungaetingTrips();
    return Promise.all(
      trips.map(async (t) => {
        const reservations = await getReservationsWithPaymentsByTripId(t.id);
        const genderByUserId = await buildGenderMap(reservations);
        const cfg = parseBungaetingConfig(t);
        let currentM = 0;
        let currentF = 0;
        for (const r of reservations.filter((r) => r.status !== "cancelled")) {
          const g = genderByUserId.get(r.userId);
          if (g === "M") currentM += r.seats;
          else if (g === "F") currentF += r.seats;
        }
        return {
          id: t.id,
          eventId: t.eventId,
          status: t.status,
          departureAt: t.departureAt,
          price: t.price,
          genderMode: cfg.genderMode,
          minCount: t.minCount,
          maxCount: t.maxCount,
          currentM,
          currentF,
          minM: cfg.genderMin?.M ?? null,
          minF: cfg.genderMin?.F ?? null,
          openChatUrl: t.openChatUrl,
        };
      })
    );
  }),

  // ── 프로필 신고 처리 ───────────────────────────────────────────────────────────
  listReports: bungaetingAdminProcedure.query(() => getPendingBungaetingReports()),

  // 직접 프로필 상태 전환 (신고와 무관하게도 가능).
  setProfileStatus: bungaetingAdminProcedure
    .input(z.object({ userId: z.number(), status: z.enum(BUNGAETING_PROFILE_STATUSES) }))
    .mutation(async ({ input, ctx }) => {
      if (input.status === "restricted") {
        const cancelled = await restrictProfileAndCancelUnconfirmed(input.userId, ctx.user.id);
        return { success: true, cancelledReservations: cancelled };
      }
      await updateBungaetingProfile(input.userId, { status: input.status });
      return { success: true, cancelledReservations: 0 };
    }),

  // 신고 해결: blind(사진·소개 가림) / restrict(이용제한+미확정 취소) / dismiss(기각).
  resolveReport: bungaetingAdminProcedure
    .input(z.object({ reportId: z.number(), action: z.enum(["blind", "restrict", "dismiss"]) }))
    .mutation(async ({ input, ctx }) => {
      const report = await getBungaetingReportById(input.reportId);
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "신고를 찾을 수 없습니다." });

      let cancelled = 0;
      if (input.action === "blind") {
        await updateBungaetingProfile(report.targetUserId, { status: "blinded" });
        await resolveBungaetingReport(input.reportId, "reviewed_blinded", ctx.user.id);
      } else if (input.action === "restrict") {
        cancelled = await restrictProfileAndCancelUnconfirmed(report.targetUserId, ctx.user.id);
        await resolveBungaetingReport(input.reportId, "reviewed_restricted", ctx.user.id);
      } else {
        await resolveBungaetingReport(input.reportId, "dismissed", ctx.user.id);
      }
      return { success: true, cancelledReservations: cancelled };
    }),

  // ── 수동 알림 발송 (SMS mock) ──────────────────────────────────────────────────
  // 발송 대상은 회차 참가자 또는 SMS 동의 선호등록자 전원만. 특정 성별 단독 타겟
  // 옵션은 제공하지 않는다 (spec §4-5: 성별 편향 재참여 권유 금지).
  sendNotification: bungaetingAdminProcedure
    .input(
      z.object({
        target: z.enum(["trip", "optIn"]),
        tripId: z.number().optional(),
        message: z.string().min(1).max(300),
      })
    )
    .mutation(async ({ input }) => {
      let recipients: { userId: number; phone: string | null }[];
      if (input.target === "trip") {
        if (!input.tripId) throw new TRPCError({ code: "BAD_REQUEST", message: "회차를 선택하세요." });
        recipients = await getBungaetingTripParticipantPhones(input.tripId);
      } else {
        recipients = await getBungaetingSmsOptInPhones();
      }
      // userId 기준 중복 제거 후 발송.
      const seen = new Set<number>();
      let sent = 0;
      for (const r of recipients) {
        if (seen.has(r.userId) || !r.phone) continue;
        seen.add(r.userId);
        await sendSms(r.phone, input.message).catch((e) => console.warn("[bungaeting.admin] sms failed:", e));
        sent++;
      }
      return { sentCount: sent };
    }),
});
