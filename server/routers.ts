import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { notifyOwner } from "./_core/notification";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  addPoints,
  createBoardingPoint,
  createEvent,
  createPaymentWithItems,
  cascadeDeleteEventWithRefunds,
  countReservationsByEventId,
  createStopCandidate,
  createTrip,
  decrementTripCount,
  deleteBoardingPoint,
  deleteEventCascade,
  getEventDeletionImpact,
  ensureReferralCode,
  getActiveRallyPointCandidates,
  getAllEvents,
  getAllReservations,
  getAllStopCandidates,
  getAllTrips,
  getAllUsers,
  getBoardingPointById,
  getBoardingPointsByEventId,
  getBoardingPointsByTripId,
  getEventById,
  getEventLikeCount,
  getEventLikeCounts,
  getEvents,
  getLatestPaymentByReservationId,
  getLikedEventIds,
  getLikedEventsByUser,
  getLatestPaymentByRideRequestId,
  getPaidPaymentItemTotalsByType,
  createEventRequest,
  getEventRequests,
  getEventRequestsByUserId,
  getFlaggedReferralEntries,
  getInterestedCandidateIds,
  getPaymentByOrderId,
  getPointTransactionsByUserId,
  getReferralCrossUsagePairs,
  getReferralStatsByReferrer,
  getShuttleDemandStatus,
  getShuttleDemandSummary,
  deleteEventRequestForUser,
  deleteShuttleDemandForUser,
  getShuttleDemandsByUserId,
  hideReservation,
  setEventRequestStatus,
  upsertShuttleDemand,
  getPaymentItemsByPaymentId,
  getPendingRideRequestsByEventId,
  getPointInterestCounts,
  getPointsByUserId,
  getReferralByReservationId,
  getReferralsByUserId,
  getReservationById,
  getReservationsByUserId,
  getReservationsWithPaymentsByTripId,
  getRideRequestById,
  getRideRequestOriginsByEventId,
  getRideRequestsByUserId,
  getTripById,
  getTripsByEventId,
  getUserById,
  getUserByOpenId,
  getUserByReferralCode,
  setStopCandidateActive,
  toggleEventLike,
  togglePointInterest,
  updateBoardingPoint,
  updateEvent,
  updateEventStatus,
  updatePaymentStatus,
  updateReferralStatus,
  updateRideRequestStatus,
  updateTrip,
  updateTripStatus,
  updateUserName,
  updateUserStatus,
} from "./db";
import {
  adminCancelReservation,
  buildFareItems,
  cancelReservationsForTrip,
  computeRefundableAmount,
  refundTossPaymentIfNeeded,
} from "./payments";
import {
  finalizeReservation,
  finalizeRideRequest,
  maybeConfirmTrip,
  resolveTicketUnitPrice,
  TICKET_TYPES,
  validatePointsUsage,
  type TossOrderContext,
} from "./reservationFlow";
import {
  resolveFlagged,
  settleTripReferrals,
  validateReferralCode,
  voidReservationReferral,
} from "./referralCredit";

// 통합 원장 타입의 표시 라벨 (memo가 없을 때 폴백).
const POINT_TX_TYPE_LABELS: Record<string, string> = {
  EARN_REFERRAL: "추천 적립",
  EARN_PROMO: "이벤트 적립",
  SPEND: "포인트 사용",
  REFUND: "포인트 환불",
  EXPIRE: "유효기간 만료 소멸",
  ADMIN_ADJUST: "운영자 조정",
};
import { auditLog } from "./audit";
import { filterUnservedCandidates } from "./pointInterests";
import { cancelTossPayment, confirmTossPayment, isTossEnabled, TossApiError } from "./toss";
import { nanoid } from "nanoid";
import { buildDemandGrid, summarizeNearbyDemand } from "./demand";
import { CONSENT_VERSIONS, recordConsent } from "./consents";
import { bungaetingRouter } from "./bungaeting/router";
import { buildGenderMap } from "./bungaeting/policy";
import { isThemeAllowed } from "./featureFlags";
import { getPolicy } from "./matching/confirmPolicy";
import { notifyEventCancellation, notifyTrip } from "./notify/tripMessenger";
import { runMatchingPipeline } from "./matching/pipeline";
import { pipelineParamsInput, resolvePipelineParams } from "./matching/matchingParams";
import { executeMatching, getMatchingStopCandidates, RALLY_POINT_CANDIDATE_ID_OFFSET, MatchingError } from "./matching/executeMatching";
import { refundUnmatchedRideRequests } from "./payments";
import { freezeEventIfUnfrozen } from "./db";
import { evaluateCancellation, isCreatedAfterOwnD5 } from "@shared/cancellationPolicy";
import { ARRIVAL_PREFERENCES, USER_STATUSES } from "../drizzle/schema";
import type { RideRequest, Trip } from "../drizzle/schema";

// ─── Admin guard ─────────────────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});

// Matching pipeline params + defaults live in matching/matchingParams.ts so
// the admin manual flow and the auto-freeze scheduler share one source.

// Re-exported for existing importers; implementation moved to
// server/reservationFlow.ts so the Toss confirm path can share it.
export { validatePointsUsage } from "./reservationFlow";

async function withAvailability(trip: Trip) {
  const policy = getPolicy(trip.theme);
  const tripReservations = await getReservationsWithPaymentsByTripId(trip.id);
  // 번개팅 반반 모드는 성별 잔여석(byGroup)을 보여주려면 성별 맵이 필요하다.
  // 표준 트립은 추가 조회 없이 기존 경로 그대로(회귀 없음).
  const ctx =
    trip.theme === "bungaeting"
      ? { genderByUserId: await buildGenderMap(tripReservations) }
      : undefined;
  return { ...trip, availability: policy.availability(trip, tripReservations, ctx) };
}

// Ride requests still counted as live demand for the map: anything that
// hasn't failed/been refunded. Excludes "route_confirmed"/"boarded" -those
// riders already have a real trip, so they're no longer open demand a new
// rider would be joining.
const DEMAND_STATUSES: RideRequest["status"][] = ["pending", "clustered"];
const NEARBY_DEMAND_RADIUS_METERS = 1500;

// Re-exported for existing importers (moved to matching/executeMatching.ts).
export { getMatchingStopCandidates, RALLY_POINT_CANDIDATE_ID_OFFSET };

export const appRouter = router({
  system: systemRouter,

  // 번개팅(동행·친목 서브서비스). 전체가 FEATURE_BUNGAETING 플래그 뒤에 있음(기본 OFF).
  bungaeting: bungaetingRouter,

  // ─── 이벤트 만들기 신청 (미등록 행사 요청서) ────────────────────────────────
  eventRequests: router({
    create: protectedProcedure
      .input(
        z.object({
          category: z.string().min(1).max(30),
          title: z.string().min(2).max(200),
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          destination: z.string().min(2).max(300),
          origin: z.string().min(2).max(300),
          arrivalTime: z.string().max(10).optional(),
          arrivalPreference: z.enum(ARRIVAL_PREFERENCES),
          arrivalNote: z.string().max(300).optional(),
          inquiry: z.string().max(500).optional(),
          phone: z.string().min(9).max(20),
          email: z.string().email().max(320),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const id = await createEventRequest({ ...input, userId: ctx.user.id, status: "pending" });
        // 운영자 알림 (mock) — 관리자 콘솔 '신청' 탭에서도 확인 가능.
        const startLabel = `${input.startDate}${input.startTime ? ` ${input.startTime}` : ""}`;
        const endLabel = input.endDate ? `~${input.endDate}${input.endTime ? ` ${input.endTime}` : ""}` : "";
        await notifyOwner({
          title: `[번개GO] 이벤트 만들기 신청: ${input.title}`,
          content: `${startLabel}${endLabel} · ${input.origin} → ${input.destination} · 연락처 ${input.phone}`,
        }).catch(() => false);
        return { id };
      }),

    // 내 이벤트 신청 내역 (마이페이지 '참가 신청' 탭).
    myList: protectedProcedure.query(({ ctx }) => getEventRequestsByUserId(ctx.user.id)),

    // 본인 신청 취소(삭제) — 소유자 일치 행만 삭제되므로 별도 권한 확인 불필요.
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const deleted = await deleteEventRequestForUser(input.id, ctx.user.id);
        if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "신청 내역을 찾을 수 없습니다." });
        return { success: true } as const;
      }),

    adminList: adminProcedure.query(() => getEventRequests()),

    setStatus: adminProcedure
      .input(z.object({ id: z.number(), status: z.enum(["pending", "done"]) }))
      .mutation(async ({ input }) => {
        await setEventRequestStatus(input.id, input.status);
        return { success: true } as const;
      }),
  }),

  // ─── 셔틀 만들기 — 희망 탑승지 수요 신청 (카카오T 수요조사식) ──────────────────
  shuttleDemands: router({
    // 현황: 이벤트별 신청 수 + (로그인 시) 내 신청 내용.
    status: publicProcedure
      .input(z.object({ eventId: z.number() }))
      .query(async ({ input, ctx }) => {
        return getShuttleDemandStatus(input.eventId, ctx.user?.id);
      }),

    // 신청/변경 — 유저당 이벤트당 1건 upsert.
    upsert: protectedProcedure
      .input(
        z.object({
          eventId: z.number(),
          area: z.enum(["capital", "other"]),
          stopLabel: z.string().min(1).max(100),
          neighborhood: z.string().max(100).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const event = await getEventById(input.eventId);
        if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "이벤트를 찾을 수 없습니다." });
        await upsertShuttleDemand(input.eventId, ctx.user.id, {
          area: input.area,
          stopLabel: input.stopLabel,
          neighborhood: input.neighborhood?.trim() || null,
        });
        return getShuttleDemandStatus(input.eventId, ctx.user.id);
      }),

    // 내 셔틀 신청(희망 탑승지) 내역 (마이페이지 '참가 신청' 탭).
    myList: protectedProcedure.query(({ ctx }) => getShuttleDemandsByUserId(ctx.user.id)),

    // 본인 수요 신청 취소 — 유저당 이벤트당 1건.
    remove: protectedProcedure
      .input(z.object({ eventId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const deleted = await deleteShuttleDemandForUser(input.eventId, ctx.user.id);
        if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "신청 내역을 찾을 수 없습니다." });
        return { success: true } as const;
      }),

    adminSummary: adminProcedure.query(() => getShuttleDemandSummary()),
  }),

  // ─── Auth ──────────────────────────────────────────────────────────────────
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),

    // 닉네임(표시 이름) 변경 — 마이페이지에서 자유 수정.
    updateNickname: protectedProcedure
      .input(z.object({ name: z.string().trim().min(1, "닉네임을 입력해주세요.").max(30, "닉네임은 30자 이내로 입력해주세요.") }))
      .mutation(async ({ input, ctx }) => {
        await updateUserName(ctx.user.id, input.name);
        return { success: true, name: input.name } as const;
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Consents ──────────────────────────────────────────────────────────────
  consents: router({
    record: protectedProcedure
      .input(z.object({ type: z.string().min(1).max(50) }))
      .mutation(async ({ input, ctx }) => {
        const version = CONSENT_VERSIONS[input.type];
        if (!version) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `알 수 없는 동의 유형입니다: ${input.type}` });
        }
        await recordConsent(ctx.user.id, input.type, version);
        return { success: true } as const;
      }),
  }),

  // ─── Events ────────────────────────────────────────────────────────────────
  events: router({
    list: publicProcedure
      .input(
        z.object({
          category: z.string().optional(),
          search: z.string().optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        })
      )
      .query(async ({ input, ctx }) => {
        const eventList = await getEvents(input);
        const ids = eventList.map((e) => e.id);
        const [likeCounts, likedIds] = await Promise.all([
          getEventLikeCounts(ids),
          ctx.user ? getLikedEventIds(ctx.user.id, ids) : Promise.resolve(new Set<number>()),
        ]);
        return eventList.map((e) => ({
          ...e,
          likeCount: likeCounts.get(e.id) ?? 0,
          myLiked: likedIds.has(e.id),
        }));
      }),

    byId: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const event = await getEventById(input.id);
        if (!event) throw new TRPCError({ code: "NOT_FOUND" });
        const [likeCount, likedIds] = await Promise.all([
          getEventLikeCount(input.id),
          ctx.user ? getLikedEventIds(ctx.user.id, [input.id]) : Promise.resolve(new Set<number>()),
        ]);
        return { ...event, likeCount, myLiked: likedIds.has(input.id) };
      }),

    // Idempotent heart toggle. protectedProcedure — a like belongs to a user.
    // Rate-limited only by the global 100/min (deliberately NOT in the
    // write-mutation 20/min list): rapid heart taps are normal usage.
    toggleLike: protectedProcedure
      .input(z.object({ eventId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const event = await getEventById(input.eventId);
        if (!event) throw new TRPCError({ code: "NOT_FOUND" });
        return toggleEventLike(input.eventId, ctx.user.id);
      }),

    myLikedList: protectedProcedure.query(({ ctx }) => getLikedEventsByUser(ctx.user.id)),

    create: protectedProcedure
      .input(
        z.object({
          title: z.string().min(2),
          category: z.enum(["concert", "sports", "festival", "rally", "exhibition", "other", "local_festival", "expo", "fair", "forum"]),
          eventDate: z.number(),
          venue: z.string().min(2),
          address: z.string().optional(),
          lat: z.string().optional(),
          lng: z.string().optional(),
          imageUrl: z.string().optional(),
          description: z.string().optional(),
          organizerName: z.string().optional(),
          // Comma-separated hidden search keywords and public tags.
          searchAliases: z.string().max(500).optional(),
          tags: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // 검색 별칭은 관리자만 지정 가능 — 일반 사용자 입력은 무시한다.
        const { searchAliases, ...rest } = input;
        const id = await createEvent({
          ...rest,
          searchAliases: ctx.user.role === "admin" ? searchAliases : undefined,
          eventDate: new Date(input.eventDate),
          creatorId: ctx.user.id,
        });
        return { id };
      }),

    updateStatus: adminProcedure
      .input(z.object({ id: z.number(), status: z.enum(["active", "cancelled", "completed"]) }))
      .mutation(async ({ input }) => {
        await updateEventStatus(input.id, input.status);
        return { success: true };
      }),

    setAutoMatch: adminProcedure
      .input(
        z.object({
          id: z.number(),
          autoMatchEnabled: z.boolean(),
          autoMatchPricePerSeat: z.number().min(0).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const event = await getEventById(input.id);
        if (!event) throw new TRPCError({ code: "NOT_FOUND" });
        if (input.autoMatchEnabled && !input.autoMatchPricePerSeat && !event.autoMatchPricePerSeat) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "자동 매칭을 켜려면 좌석당 가격이 필요합니다.",
          });
        }
        await updateEvent(input.id, {
          autoMatchEnabled: input.autoMatchEnabled,
          autoMatchPricePerSeat: input.autoMatchPricePerSeat ?? event.autoMatchPricePerSeat,
        });
        return { success: true };
      }),

    adminList: adminProcedure.query(() => getAllEvents()),
  }),

  // ─── Trips ─────────────────────────────────────────────────────────────────
  trips: router({
    byEventId: publicProcedure
      .input(z.object({ eventId: z.number() }))
      .query(async ({ input }) => {
        const tripsForEvent = await getTripsByEventId(input.eventId);
        const visible = tripsForEvent.filter((trip) => isThemeAllowed(trip.theme));
        return Promise.all(visible.map(withAvailability));
      }),

    byId: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const trip = await getTripById(input.id);
        if (!trip) throw new TRPCError({ code: "NOT_FOUND" });
        return withAvailability(trip);
      }),

    create: protectedProcedure
      .input(
        z
          .object({
            eventId: z.number(),
            mode: z.enum(["bus", "van"]).default("bus"),
            minCount: z.number().min(1),
            maxCount: z.number().min(1),
            price: z.number().min(0).max(1_000_000, "1인당 요금은 100만원을 초과할 수 없습니다."),
            // 편도(행사장행/귀가행) 1인 요금 — 미지정이면 편도 탑승권 미판매.
            oneWayPrice: z.number().min(0).max(1_000_000).optional(),
            departureAt: z.number(),
            returnAt: z.number().optional(),
            isRoundTrip: z.boolean().default(false),
            notes: z.string().optional(),
            theme: z.string().max(20).default("standard"),
          })
          .refine((data) => data.minCount <= data.maxCount, {
            message: "최소 인원은 최대 인원보다 클 수 없습니다.",
            path: ["minCount"],
          })
      )
      .mutation(async ({ input, ctx }) => {
        if (!isThemeAllowed(input.theme)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "테마 트립 기능이 아직 활성화되지 않았습니다." });
        }

        const id = await createTrip({
          ...input,
          departureAt: new Date(input.departureAt),
          returnAt: input.returnAt ? new Date(input.returnAt) : undefined,
          creatorId: ctx.user.id,
        });
        return { id };
      }),

    updateStatus: adminProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["collecting", "confirmed", "in_progress", "completed", "cancelled"]),
        })
      )
      .mutation(async ({ input }) => {
        const trip = await getTripById(input.id);
        if (!trip) throw new TRPCError({ code: "NOT_FOUND" });

        const shouldCascadeRefund =
          input.status === "cancelled" && (trip.status === "collecting" || trip.status === "confirmed");

        await updateTripStatus(input.id, input.status, input.status === "cancelled" ? "admin_cancel" : undefined);

        if (shouldCascadeRefund) {
          await cancelReservationsForTrip(trip);
        }

        // 운행 완료 = 추천 건 적립 확정 시점 (referral-credit-spec §4.3).
        // settleReferralEntry가 건별 PENDING 조건부 전환이라 중복 호출에도 안전.
        if (input.status === "completed") {
          await settleTripReferrals(input.id);
        }

        return { success: true };
      }),

    adminList: adminProcedure.query(async () => {
      const allTrips = await getAllTrips();
      const visible = allTrips.filter((trip) => isThemeAllowed(trip.theme));
      return Promise.all(visible.map(withAvailability));
    }),
  }),

  // ─── Boarding Points ───────────────────────────────────────────────────────
  boardingPoints: router({
    byTripId: publicProcedure
      .input(z.object({ tripId: z.number() }))
      .query(({ input }) => getBoardingPointsByTripId(input.tripId)),

    byEventId: publicProcedure
      .input(z.object({ eventId: z.number() }))
      .query(({ input }) => getBoardingPointsByEventId(input.eventId)),

    detailById: publicProcedure
      .input(z.object({ boardingPointId: z.number() }))
      .query(async ({ input }) => {
        const point = await getBoardingPointById(input.boardingPointId);
        if (!point) throw new TRPCError({ code: "NOT_FOUND" });

        const owningTrip = await getTripById(point.tripId);
        if (!owningTrip) throw new TRPCError({ code: "NOT_FOUND" });

        const center =
          point.lat && point.lng
            ? { lat: Number(point.lat), lng: Number(point.lng) }
            : null;

        const [eventPoints, origins] = await Promise.all([
          getBoardingPointsByEventId(owningTrip.eventId),
          center ? getRideRequestOriginsByEventId(owningTrip.eventId, DEMAND_STATUSES) : Promise.resolve([]),
        ]);

        const sameLocationPoints = eventPoints.filter((candidate) => {
          if (candidate.id === point.id) return true;
          if (!center || !candidate.lat || !candidate.lng) return false;
          return Number(candidate.lat) === center.lat && Number(candidate.lng) === center.lng;
        });

        const tripRows = await Promise.all(
          sameLocationPoints.map(async (boardingPoint) => {
            const trip = await getTripById(boardingPoint.tripId);
            if (!trip || !isThemeAllowed(trip.theme)) return null;
            const tripWithAvailability = await withAvailability(trip);
            return {
              id: trip.id,
              status: trip.status,
              price: trip.price,
              departureAt: trip.departureAt,
              pickupTime: boardingPoint.pickupTime,
              currentCount: trip.currentCount,
              minCount: trip.minCount,
              maxCount: trip.maxCount,
              availability: {
                remaining: tripWithAvailability.availability.remaining,
              },
            };
          })
        );

        return {
          point,
          nearbyDemand: center
            ? summarizeNearbyDemand(origins, center, NEARBY_DEMAND_RADIUS_METERS)
            : { count: 0, seats: 0 },
          trips: tripRows.filter((trip): trip is NonNullable<typeof trip> => trip !== null),
        };
      }),

    create: protectedProcedure
      .input(
        z.object({
          tripId: z.number(),
          name: z.string().min(1),
          address: z.string().optional(),
          lat: z.string().optional(),
          lng: z.string().optional(),
          pickupTime: z.number().optional(),
          order: z.number().default(0),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const trip = await getTripById(input.tripId);
        if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "셔틀을 찾을 수 없습니다." });
        if (trip.creatorId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "본인이 만든 셔틀에만 정류장을 추가할 수 있습니다." });
        }

        const id = await createBoardingPoint({
          ...input,
          pickupTime: input.pickupTime ? new Date(input.pickupTime) : undefined,
        });
        return { id };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteBoardingPoint(input.id);
        return { success: true };
      }),
  }),

  // ─── Reservations ──────────────────────────────────────────────────────────
  reservations: router({
    myList: protectedProcedure.query(({ ctx }) =>
      getReservationsByUserId(ctx.user.id)
    ),

    byId: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const res = await getReservationById(input.id);
        if (!res) throw new TRPCError({ code: "NOT_FOUND" });
        if (res.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return res;
      }),

    create: protectedProcedure
      .input(
        z.object({
          tripId: z.number(),
          boardingPointId: z.number().optional(),
          seats: z.number().min(1).max(8),
          ticketType: z.enum(TICKET_TYPES).default("round"),
          passengerName: z.string().min(1),
          passengerPhone: z.string().min(1),
          passengerEmail: z.string().email().optional(),
          pointsUsed: z.number().min(0).default(0),
          referralCode: z.string().optional(),
          referralSource: z.enum(["LINK_PREFILL", "MANUAL"]).optional(),
          paymentMethod: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // Mock (demo) payment path. The Toss path goes through
        // payments.createTossOrder → payments.confirmToss instead, sharing
        // finalizeReservation for the seat-locked reservation itself.
        if (ctx.user.status === "suspended") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "정지된 계정은 예약을 생성할 수 없습니다. 고객센터로 문의해주세요.",
          });
        }

        const trip = await getTripById(input.tripId);
        if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "셔틀을 찾을 수 없습니다." });

        // 추천 코드는 결제 전에 검증해 거부한다 (spec §3.3 — 셀프/무효 코드).
        if (input.referralCode) {
          const check = await validateReferralCode(input.referralCode, ctx.user.id);
          if (!check.ok) throw new TRPCError({ code: "BAD_REQUEST", message: check.reason });
        }

        const unitPrice = resolveTicketUnitPrice(trip, input.ticketType);
        const reservationId = await finalizeReservation(ctx.user, input, async (id) => {
          const items = buildFareItems({ fareAmount: unitPrice * input.seats, pointsUsed: input.pointsUsed });
          await createPaymentWithItems({ reservationId: id, method: "mock", chargeType: "prepaid", items });
        });

        return { id: reservationId };
      }),

    cancel: protectedProcedure
      .input(z.object({ id: z.number(), reason: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const res = await getReservationById(input.id);
        if (!res) throw new TRPCError({ code: "NOT_FOUND" });
        if (res.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        if (res.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "이미 취소된 예약입니다." });

        const trip = await getTripById(res.tripId);
        if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "셔틀을 찾을 수 없습니다." });

        const now = new Date();
        const decision = evaluateCancellation(trip.departureAt, res.createdAt, now);
        if (!decision.allowed) {
          throw new TRPCError({ code: "BAD_REQUEST", message: decision.reason });
        }

        const payment = await getLatestPaymentByReservationId(res.id);
        if (payment) {
          const items = await getPaymentItemsByPaymentId(payment.id);
          const refundTotal = items.reduce(
            (sum, item) => sum + computeRefundableAmount(item, trip, res.createdAt, now, "user_request"),
            0
          );
          // 토스 실결제는 수수료 정책 반영액만큼 실제 취소(부분/전액)한다.
          // 실패 시 로컬 취소도 중단해 사용자가 재시도할 수 있게 한다.
          if (payment.status === "paid") {
            try {
              await refundTossPaymentIfNeeded(payment, refundTotal, "사용자 예약 취소");
            } catch (error) {
              console.error(`[reservations.cancel] toss refund failed for payment ${payment.id}:`, error);
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "환불 처리에 실패했습니다. 잠시 후 다시 시도해주세요.",
              });
            }
          }
          await updatePaymentStatus(payment.id, "cancelled", {
            cancelledAt: now,
            cancelReason: "user_request",
            cancelNote: input.reason
              ? `${input.reason} (환불액 ${refundTotal}원)`
              : `환불액 ${refundTotal}원`,
          });
        }
        await decrementTripCount(res.tripId, res.seats);

        // Refund points used
        if (res.pointsUsed > 0) {
          await addPoints(ctx.user.id, res.pointsUsed, "refund", "예약 취소 포인트 환불", String(res.id));
        }

        // Claw back referral bonus this reservation triggered, so a
        // reserve→cancel loop with a referral code can't farm points.
        const referral = await getReferralByReservationId(res.id);
        if (referral && referral.status === "completed") {
          await addPoints(
            referral.referrerId,
            -referral.referrerPoints,
            "usage",
            "예약 취소로 인한 추천 적립 회수",
            String(res.id)
          );
          await addPoints(
            referral.refereeId,
            -referral.refereePoints,
            "usage",
            "예약 취소로 인한 추천 적립 회수",
            String(res.id)
          );
          await updateReferralStatus(referral.id, "cancelled");
        }

        // 신규 추천 건은 결제자 자진 취소 시 해당 건만 VOID (spec §4.4 — 주문
        // 단위라 같은 코드의 다른 결제 건에는 영향 없음).
        await voidReservationReferral(res.id);

        return { success: true };
      }),

    // 취소/환불된 내역을 마이페이지에서 숨긴다 (소프트 삭제 — DB엔 남음).
    // 활성(paid/pending) 예약은 숨길 수 없다.
    hide: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const res = await getReservationById(input.id);
        if (!res) throw new TRPCError({ code: "NOT_FOUND" });
        if (res.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        if (res.status !== "cancelled" && res.status !== "refunded") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "취소된 내역만 삭제할 수 있습니다." });
        }
        await hideReservation(input.id);
        return { success: true } as const;
      }),

    // Admin-only escape hatch: bypasses the D-5 cancellation window entirely
    // and always refunds in full (operator-fault/force-majeure cases — e.g.
    // an operational problem discovered after D-5, where the user shouldn't
    // eat the cancellation fee). Which admin acted is recorded in the
    // payment's cancelNote for audit purposes, since payments has no
    // dedicated "cancelled by" column.
    adminCancel: adminProcedure
      .input(z.object({ id: z.number(), reason: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        // 취소·환불 로직은 payments.adminCancelReservation 한 곳 (번개팅 이용제한도 공유).
        await adminCancelReservation(input.id, ctx.user.id, input.reason);
        return { success: true };
      }),

    adminList: adminProcedure.query(() => getAllReservations()),
  }),

  // ─── Payments (Toss Payments 실결제) ─────────────────────────────────────────
  // 표준 위젯 v2 플로우: createTossOrder(서버가 금액 계산 + pending 주문 저장)
  // → 클라이언트 위젯 결제 → successUrl 리다이렉트 → confirmToss(금액 대조 후
  // 승인 API 호출 → 좌석 락 확정). 금액은 어느 단계에서도 클라이언트를 신뢰하지
  // 않는다.
  payments: router({
    tossEnabled: publicProcedure.query(() => ({ enabled: isTossEnabled() })),

    createTossOrder: protectedProcedure
      .input(
        z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("reservation"),
            tripId: z.number(),
            boardingPointId: z.number().optional(),
            seats: z.number().min(1).max(8),
            ticketType: z.enum(TICKET_TYPES).default("round"),
            passengerName: z.string().min(1),
            passengerPhone: z.string().min(1),
            passengerEmail: z.string().email().optional(),
            pointsUsed: z.number().min(0).default(0),
            referralCode: z.string().optional(),
            referralSource: z.enum(["LINK_PREFILL", "MANUAL"]).optional(),
          }),
          z.object({
            kind: z.literal("rideRequest"),
            eventId: z.number(),
            originAddress: z.string().optional(),
            originLat: z.string(),
            originLng: z.string(),
            targetArrivalAt: z.number(),
            seats: z.number().min(1).max(8),
            passengerName: z.string().min(1),
            passengerPhone: z.string().min(1),
            passengerEmail: z.string().email().optional(),
            pointsUsed: z.number().min(0).default(0),
            referralCode: z.string().optional(),
          }),
        ])
      )
      .mutation(async ({ input, ctx }) => {
        if (!isTossEnabled()) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "토스 결제가 설정되지 않았습니다." });
        }
        if (ctx.user.status === "suspended") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "정지된 계정은 결제를 진행할 수 없습니다. 고객센터로 문의해주세요.",
          });
        }

        let fareAmount: number;
        let orderName: string;

        if (input.kind === "reservation") {
          const trip = await getTripById(input.tripId);
          if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "셔틀을 찾을 수 없습니다." });

          // 추천 코드는 결제창 진입 전에 거부 (spec §3.3).
          if (input.referralCode) {
            const check = await validateReferralCode(input.referralCode, ctx.user.id);
            if (!check.ok) throw new TRPCError({ code: "BAD_REQUEST", message: check.reason });
          }

          const unitPrice = resolveTicketUnitPrice(trip, input.ticketType);
          validatePointsUsage(input.pointsUsed, ctx.user.pointsBalance, unitPrice * input.seats);

          // Soft availability check so a sold-out trip fails before the user
          // reaches the payment window; the binding check is the seat lock
          // inside confirmToss → finalizeReservation.
          const { availability } = await withAvailability(trip);
          if (input.seats > availability.remaining) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "좌석이 부족합니다." });
          }

          fareAmount = unitPrice * input.seats;
          const event = await getEventById(trip.eventId);
          const ticketLabel =
            input.ticketType === "outbound" ? " 행사장행" : input.ticketType === "inbound" ? " 귀가행" : "";
          orderName = `${event?.title ?? "셔틀"} ${input.seats}석${ticketLabel}`.slice(0, 100);
        } else {
          // Track B: 상한가(autoMatchPricePerSeat) 기준 선결제. 배차 확정 시
          // 최종가와의 차액이 부분취소로 환불된다 (admin.matching.commit).
          const event = await getEventById(input.eventId);
          if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "이벤트를 찾을 수 없습니다." });
          if (!event.autoMatchEnabled) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "이 이벤트는 자동 배차를 지원하지 않습니다." });
          }
          if (event.matchingFrozenAt) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "이미 배차가 확정된 이벤트입니다." });
          }
          if (!event.autoMatchPricePerSeat) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "이벤트 가격 설정이 없습니다." });
          }

          fareAmount = event.autoMatchPricePerSeat * input.seats;
          validatePointsUsage(input.pointsUsed, ctx.user.pointsBalance, fareAmount);
          orderName = `${event.title} 참가 신청 ${input.seats}석`.slice(0, 100);
        }

        const amount = fareAmount - input.pointsUsed;
        if (amount < 100) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "토스 결제 최소 금액(100원) 미만입니다. 포인트 사용액을 조정해주세요.",
          });
        }

        // Toss orderId: 6-64 chars of [A-Za-z0-9-_=]; nanoid's default
        // alphabet is a subset of that.
        const orderId = `bungae-${nanoid(21)}`;
        const context: TossOrderContext = { ...input, userId: ctx.user.id };
        await createPaymentWithItems({
          reservationId: null,
          method: "toss",
          chargeType: "prepaid",
          status: "pending",
          orderId,
          orderContext: context,
          items: buildFareItems({ fareAmount, pointsUsed: input.pointsUsed }),
        });

        return { orderId, amount, orderName };
      }),

    confirmToss: protectedProcedure
      .input(
        z.object({
          paymentKey: z.string().min(1),
          orderId: z.string().min(6).max(64),
          amount: z.number().int().positive(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const payment = await getPaymentByOrderId(input.orderId);
        if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "주문을 찾을 수 없습니다." });

        const context = payment.orderContext as TossOrderContext | null;
        if (!context || context.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        // Double-submit of the same success callback: already finalized.
        if (payment.status === "paid") {
          if (context.kind === "reservation" && payment.reservationId) {
            return { kind: "reservation" as const, reservationId: payment.reservationId };
          }
          if (context.kind === "rideRequest" && payment.rideRequestId) {
            return { kind: "rideRequest" as const, requestId: payment.rideRequestId };
          }
        }
        if (payment.status !== "pending") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "이미 처리된 주문입니다." });
        }

        // ⚠️ 금액 변조 방어의 핵심: successUrl로 돌아온 amount를 주문 생성
        // 시점에 서버가 계산해 둔 금액과 대조하고, 불일치면 승인 API를 아예
        // 호출하지 않는다.
        if (input.amount !== payment.totalAmount) {
          await updatePaymentStatus(payment.id, "cancelled", {
            cancelledAt: new Date(),
            cancelReason: "payment_failed",
            cancelNote: `금액 불일치: 콜백 ${input.amount}원 ≠ 주문 ${payment.totalAmount}원`,
          });
          throw new TRPCError({ code: "BAD_REQUEST", message: "결제 금액이 주문 금액과 일치하지 않습니다." });
        }

        // 승인 "전" 소프트 체크: 확정이 불가능한 게 확실하면 과금 자체를
        // 막는다. (구속력 있는 검증은 승인 후 finalize 단계에서 다시 한다.)
        if (context.kind === "reservation") {
          const trip = await getTripById(context.tripId);
          if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "셔틀을 찾을 수 없습니다." });
          const { availability } = await withAvailability(trip);
          if (context.seats > availability.remaining) {
            await updatePaymentStatus(payment.id, "cancelled", {
              cancelledAt: new Date(),
              cancelReason: "payment_failed",
              cancelNote: "승인 전 좌석 매진",
            });
            throw new TRPCError({ code: "CONFLICT", message: "좌석이 마감되어 결제를 진행하지 않았습니다." });
          }
        } else {
          const event = await getEventById(context.eventId);
          if (!event || !event.autoMatchEnabled || event.matchingFrozenAt) {
            await updatePaymentStatus(payment.id, "cancelled", {
              cancelledAt: new Date(),
              cancelReason: "payment_failed",
              cancelNote: "승인 전 신청 불가 상태 (이벤트 마감/동결)",
            });
            throw new TRPCError({ code: "CONFLICT", message: "참가 신청이 마감되어 결제를 진행하지 않았습니다." });
          }
        }

        let tossPayment;
        try {
          tossPayment = await confirmTossPayment(input);
        } catch (error) {
          if (error instanceof TossApiError) {
            if (error.code === "ALREADY_PROCESSED_PAYMENT") {
              // 같은 paymentKey에 대한 동시 승인 요청 - 다른 호출이 확정 중.
              throw new TRPCError({ code: "CONFLICT", message: "이미 처리 중인 결제입니다. 잠시 후 예약 내역을 확인해주세요." });
            }
            await updatePaymentStatus(payment.id, "cancelled", {
              cancelledAt: new Date(),
              cancelReason: "payment_failed",
              cancelNote: `토스 승인 실패 (${error.code})`.slice(0, 300),
            });
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          }
          throw error;
        }

        try {
          if (context.kind === "reservation") {
            const reservationId = await finalizeReservation(ctx.user, context, async (id) => {
              await updatePaymentStatus(payment.id, "paid", {
                paidAt: new Date(),
                tossPaymentKey: tossPayment.paymentKey,
                reservationId: id,
              });
            });
            return { kind: "reservation" as const, reservationId };
          }
          const requestId = await finalizeRideRequest(ctx.user, context, "toss", async (id) => {
            await updatePaymentStatus(payment.id, "paid", {
              paidAt: new Date(),
              tossPaymentKey: tossPayment.paymentKey,
              rideRequestId: id,
            });
          });
          return { kind: "rideRequest" as const, requestId };
        } catch (error) {
          // attachPayment 이후(예약/신청 커밋 이후)의 부수 단계에서 실패한
          // 경우 본체는 성공했으므로 결제를 취소하면 안 된다.
          const current = await getPaymentByOrderId(input.orderId);
          if (current?.status === "paid" && context.kind === "reservation" && current.reservationId) {
            console.error("[payments.confirmToss] post-reservation step failed (kept):", error);
            return { kind: "reservation" as const, reservationId: current.reservationId };
          }
          if (current?.status === "paid" && context.kind === "rideRequest" && current.rideRequestId) {
            console.error("[payments.confirmToss] post-request step failed (kept):", error);
            return { kind: "rideRequest" as const, requestId: current.rideRequestId };
          }

          // 승인됐는데 확정 실패(좌석 경쟁/동결 경쟁): 즉시 전액 자동 취소.
          try {
            await cancelTossPayment({
              paymentKey: tossPayment.paymentKey,
              cancelReason: "좌석 확보 실패 자동 취소",
              idempotencyKey: `auto-cancel-${payment.id}`,
            });
            await updatePaymentStatus(payment.id, "cancelled", {
              cancelledAt: new Date(),
              cancelReason: "payment_failed",
              cancelNote: "승인 후 좌석 확보 실패 - 전액 자동 취소",
            });
          } catch (cancelError) {
            console.error(`[payments.confirmToss] auto-cancel failed for payment ${payment.id}:`, cancelError);
            await updatePaymentStatus(payment.id, "cancelled", {
              cancelledAt: new Date(),
              cancelReason: "payment_failed",
              cancelNote: "승인 후 좌석 확보 실패 - 자동 취소 실패, 수동 환불 필요",
            });
            await notifyOwner({
              title: "[번개GO] 토스 자동 취소 실패 - 수동 환불 필요",
              content: `payment #${payment.id} (orderId ${input.orderId}, paymentKey ${tossPayment.paymentKey}) 승인 후 좌석 확보에 실패했으나 자동 취소도 실패했습니다.`,
            }).catch(() => false);
          }

          const message = error instanceof TRPCError ? error.message : "예약 확정에 실패했습니다.";
          throw new TRPCError({ code: "CONFLICT", message: `${message} 결제는 자동 취소되었습니다.` });
        }
      }),

    failToss: protectedProcedure
      .input(z.object({ orderId: z.string(), code: z.string().optional(), message: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const payment = await getPaymentByOrderId(input.orderId);
        if (!payment) throw new TRPCError({ code: "NOT_FOUND" });
        const context = payment.orderContext as TossOrderContext | null;
        if (!context || context.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        // Idempotent: only a still-pending order transitions to failed.
        if (payment.status === "pending") {
          await updatePaymentStatus(payment.id, "cancelled", {
            cancelledAt: new Date(),
            cancelReason: "payment_failed",
            cancelNote: `토스 결제 실패${input.code ? ` (${input.code})` : ""}${input.message ? `: ${input.message}` : ""}`.slice(0, 300),
          });
        }
        return { success: true };
      }),
  }),

  // ─── Ride Requests (pre-matching signup, auto-match events) ──────────────────
  rideRequests: router({
    // Anonymized demand map: aggregated grid cells only (see server/demand.ts) -
    // never a userId, name, phone, address, or exact coordinate. Public because
    // it carries nothing sensitive; empty for events without auto-matching.
    demandByEvent: publicProcedure
      .input(z.object({ eventId: z.number() }))
      .query(async ({ input }) => {
        const event = await getEventById(input.eventId);
        if (!event || !event.autoMatchEnabled) return [];
        const origins = await getRideRequestOriginsByEventId(input.eventId, DEMAND_STATUSES);
        return buildDemandGrid(origins);
      }),

    myList: protectedProcedure.query(({ ctx }) => getRideRequestsByUserId(ctx.user.id)),

    byId: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const req = await getRideRequestById(input.id);
        if (!req) throw new TRPCError({ code: "NOT_FOUND" });
        if (req.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return req;
      }),

    create: protectedProcedure
      .input(
        z.object({
          eventId: z.number(),
          originAddress: z.string().optional(),
          originLat: z.string(),
          originLng: z.string(),
          targetArrivalAt: z.number(),
          seats: z.number().min(1).max(8),
          passengerName: z.string().min(1),
          passengerPhone: z.string().min(1),
          passengerEmail: z.string().email().optional(),
          pointsUsed: z.number().min(0).default(0),
          referralCode: z.string().optional(),
          paymentMethod: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // Mock (demo) payment path. The Toss path goes through
        // payments.createTossOrder(kind: "rideRequest") → confirmToss.
        const requestId = await finalizeRideRequest(ctx.user, input, input.paymentMethod ?? "mock");
        return { id: requestId };
      }),

    cancel: protectedProcedure
      .input(z.object({ id: z.number(), reason: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const req = await getRideRequestById(input.id);
        if (!req) throw new TRPCError({ code: "NOT_FOUND" });
        if (req.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        if (req.status !== "pending") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "이미 매칭이 진행된 신청은 취소할 수 없습니다." });
        }

        // 토스 선결제 신청이면 남은 금액 전액 취소. 실패 시 신청 취소도
        // 중단해 사용자가 재시도할 수 있게 한다.
        const payment = await getLatestPaymentByRideRequestId(req.id);
        if (payment && payment.status === "paid") {
          const remaining = payment.totalAmount - payment.refundedAmount;
          try {
            await refundTossPaymentIfNeeded(payment, remaining, "참가 신청 취소 환불");
          } catch (error) {
            console.error(`[rideRequests.cancel] toss refund failed for payment ${payment.id}:`, error);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "환불 처리에 실패했습니다. 잠시 후 다시 시도해주세요.",
            });
          }
          await updatePaymentStatus(payment.id, "cancelled", {
            cancelledAt: new Date(),
            cancelReason: "user_request",
            cancelNote: `참가 신청 취소 (환불액 ${remaining}원)`,
            refundedAmount: payment.totalAmount,
          });
        }

        await updateRideRequestStatus(req.id, "failed_refunded", { refundedAt: new Date() });
        if (req.pointsUsed > 0) {
          await addPoints(req.userId, req.pointsUsed, "refund", "참가 신청 취소 포인트 환불", String(req.id));
        }

        return { success: true };
      }),
  }),

  // ─── Points ────────────────────────────────────────────────────────────────
  points: router({
    // 통합 원장(point_transactions) + 레거시(points) 병합 내역 — 최신순.
    myHistory: protectedProcedure.query(async ({ ctx }) => {
      const [legacy, ledger] = await Promise.all([
        getPointsByUserId(ctx.user.id),
        getPointTransactionsByUserId(ctx.user.id),
      ]);
      const merged = [
        ...ledger.map((t) => ({
          id: `t-${t.id}`,
          amount: t.amount,
          description: t.memo ?? POINT_TX_TYPE_LABELS[t.type] ?? t.type,
          createdAt: t.createdAt,
        })),
        ...legacy.map((p) => ({
          id: `p-${p.id}`,
          amount: p.amount,
          description: p.description ?? p.type,
          createdAt: p.createdAt,
        })),
      ];
      merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return merged;
    }),
    myBalance: protectedProcedure.query(async ({ ctx }) => {
      return {
        balance: ctx.user.pointsBalance ?? 0,
        // 전체 리셋 방식 만료일 (referral-credit-spec §6). null = 만료 관리 이전 잔액.
        expiresAt: ctx.user.pointsExpiresAt ?? null,
      };
    }),
  }),

  // ─── Referrals (주문 단위 추천·크레딧 — referral-credit-spec) ─────────────────
  referrals: router({
    myCode: protectedProcedure.query(async ({ ctx }) => {
      const code = await ensureReferralCode(ctx.user.id);
      return { code };
    }),
    myList: protectedProcedure.query(({ ctx }) =>
      getReferralsByUserId(ctx.user.id)
    ),

    // 결제 화면 실시간 검증 (spec §10): 존재·셀프·활성.
    validateCode: protectedProcedure
      .input(z.object({ code: z.string().min(1).max(16) }))
      .query(({ input, ctx }) => validateReferralCode(input.code, ctx.user.id)),

    // 내 추천 실적: 건수(대기/지급/보류/무효) + 누적 적립액.
    myStats: protectedProcedure.query(({ ctx }) => getReferralStatsByReferrer(ctx.user.id)),
  }),

  // ─── Stop Candidates (admin-managed reusable pickup points) ──────────────────
  stopCandidates: router({
    list: adminProcedure.query(() => getAllStopCandidates()),

    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(1),
          address: z.string().optional(),
          lat: z.string(),
          lng: z.string(),
          capacity: z.number().optional(),
          safeForCoach: z.boolean().default(true),
        })
      )
      .mutation(async ({ input }) => {
        const id = await createStopCandidate(input);
        return { id };
      }),

    setActive: adminProcedure
      .input(z.object({ id: z.number(), active: z.boolean() }))
      .mutation(async ({ input }) => {
        await setStopCandidateActive(input.id, input.active);
        return { success: true };
      }),
  }),

  // ─── Rally Point Candidates (community-sourced, unverified pickup spots) ─────
  rallyPointCandidates: router({
    list: publicProcedure.query(() => getActiveRallyPointCandidates()),
  }),

  // ─── Point Interests (+1 여기서 출발 원해요) ──────────────────────────────────
  // 결제·입력 없는 수요 신호: 다음 트립을 어디 깔지 판단할 운영 데이터.
  pointInterests: router({
    // 이벤트별 후보 목록 + 관심 수 + 내 관심 여부. 이미 셔틀이 서는
    // 정류장(기존 탑승 포인트 반경 내)과 겹치는 후보는 제외한다.
    byEvent: publicProcedure
      .input(z.object({ eventId: z.number() }))
      .query(async ({ input, ctx }) => {
        const event = await getEventById(input.eventId);
        if (!event) throw new TRPCError({ code: "NOT_FOUND" });

        const [candidates, eventBoardingPoints, counts, mine] = await Promise.all([
          getActiveRallyPointCandidates(),
          getBoardingPointsByEventId(input.eventId),
          getPointInterestCounts(input.eventId),
          ctx.user ? getInterestedCandidateIds(input.eventId, ctx.user.id) : Promise.resolve(new Set<number>()),
        ]);

        return filterUnservedCandidates(candidates, eventBoardingPoints).map((c) => ({
          id: c.id,
          name: c.name,
          region: c.region,
          count: counts.get(c.id) ?? 0,
          myInterested: mine.has(c.id),
        }));
      }),

    // 멱등 토글. 하트와 마찬가지로 연타가 정상 사용이라 쓰기뮤테이션
    // 리밋에 넣지 않는다 (전역 100/min만).
    toggle: protectedProcedure
      .input(z.object({ eventId: z.number(), rallyPointCandidateId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const event = await getEventById(input.eventId);
        if (!event) throw new TRPCError({ code: "NOT_FOUND" });
        return togglePointInterest(input.eventId, input.rallyPointCandidateId, ctx.user.id);
      }),
  }),

  // ─── Admin ─────────────────────────────────────────────────────────────────
  admin: router({
    // ── 레퍼럴 관리 (referral-credit-spec §7-6, §7-5) ──
    referral: router({
      listFlagged: adminProcedure.query(async () => {
        const entries = await getFlaggedReferralEntries();
        // 관리자 화면 표시용 이름 붙이기 (건수 적어 개별 조회로 충분).
        return Promise.all(
          entries.map(async (e) => {
            const [payer, referrer] = await Promise.all([
              getUserById(e.payerUserId),
              getUserById(e.referrerUserId),
            ]);
            return { ...e, payerName: payer?.name ?? null, referrerName: referrer?.name ?? null };
          })
        );
      }),

      resolve: adminProcedure
        .input(z.object({ id: z.number(), action: z.enum(["approve", "reject"]) }))
        .mutation(async ({ input, ctx }) => {
          const ok = await resolveFlagged(input.id, input.action);
          if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "처리할 수 없는 건입니다 (이미 처리됨)." });
          auditLog(ctx.user.id, "referral.resolve", { type: "referralEntry", id: input.id }, { action: input.action });
          return { success: true } as const;
        }),

      // 교차 입력 모니터링 — 서로의 코드를 입력한 유저 쌍 집계 (파일럿: 노출만).
      crossUsage: adminProcedure.query(async () => {
        const pairs = await getReferralCrossUsagePairs();
        return Promise.all(
          pairs.map(async (p) => {
            const [a, b] = await Promise.all([getUserById(p.userA), getUserById(p.userB)]);
            return { ...p, userAName: a?.name ?? null, userBName: b?.name ?? null };
          })
        );
      }),
    }),

    users: adminProcedure.query(() => getAllUsers()),
    updateUserStatus: adminProcedure
      .input(z.object({ userId: z.number(), status: z.enum(USER_STATUSES) }))
      .mutation(async ({ input }) => {
        await updateUserStatus(input.userId, input.status);
        return { success: true } as const;
      }),
    stats: adminProcedure.query(async () => {
      const [allEvents, allTrips, allReservations, allUsers, revenueByItemType] = await Promise.all([
        getAllEvents(),
        getAllTrips(),
        getAllReservations(),
        getAllUsers(),
        getPaidPaymentItemTotalsByType(),
      ]);
      return {
        totalEvents: allEvents.length,
        activeEvents: allEvents.filter((e) => e.status === "active").length,
        totalTrips: allTrips.length,
        confirmedTrips: allTrips.filter((t) => t.status === "confirmed").length,
        totalReservations: allReservations.length,
        paidReservations: allReservations.filter((r) => r.status === "paid").length,
        totalUsers: allUsers.length,
        totalRevenue: allReservations
          .filter((r) => r.status === "paid")
          .reduce((sum, r) => sum + r.totalAmount, 0),
        revenueByItemType,
      };
    }),

    // ─── 배차 매칭 (route-matching pipeline) ──────────────────────────────────
    matching: router({
      pendingRequests: adminProcedure
        .input(z.object({ eventId: z.number() }))
        .query(({ input }) => getPendingRideRequestsByEventId(input.eventId)),

      preview: adminProcedure
        .input(z.object({ eventId: z.number(), params: pipelineParamsInput }))
        .mutation(async ({ input }) => {
          const event = await getEventById(input.eventId);
          if (!event) throw new TRPCError({ code: "NOT_FOUND" });
          if (!event.lat || !event.lng) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "이벤트에 좌표(장소)가 설정되어 있지 않습니다." });
          }

          const [pendingRequests, stopCandidatesForPipeline] = await Promise.all([
            getPendingRideRequestsByEventId(input.eventId),
            getMatchingStopCandidates(),
          ]);

          const output = runMatchingPipeline({
            eventId: input.eventId,
            venue: { lat: Number(event.lat), lng: Number(event.lng) },
            requests: pendingRequests.map((r) => ({
              id: r.id,
              lat: Number(r.originLat),
              lng: Number(r.originLng),
              targetArrivalAt: r.targetArrivalAt,
              seats: r.seats,
            })),
            stopCandidates: stopCandidatesForPipeline,
            params: resolvePipelineParams(input.params),
          });

          return output;
        }),

      commit: adminProcedure
        .input(
          z.object({
            eventId: z.number(),
            params: pipelineParamsInput,
            // 관리자가 실제 대절가 기준으로 입력하는 트립 최종 1인 가격.
            // 생략하면 상한가 그대로 확정(차액 0). 상한가 초과는 거부.
            finalPricePerSeat: z.number().int().positive().optional(),
          })
        )
        .mutation(async ({ input, ctx }) => {
          const event = await getEventById(input.eventId);
          if (!event) throw new TRPCError({ code: "NOT_FOUND" });
          if (!event.lat || !event.lng) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "이벤트에 좌표(장소)가 설정되어 있지 않습니다." });
          }

          // A frozen event is normally final. The one exception: the D-7
          // auto-freeze preempted it but its matching then failed, leaving the
          // event frozen with no pipeline trips — admin can resume with a
          // manual commit. Once pipeline trips exist, no more recompute.
          if (event.matchingFrozenAt) {
            const existingTrips = await getTripsByEventId(input.eventId);
            const hasPipelineTrips = existingTrips.some((t) => t.sourceClusterId != null);
            if (hasPipelineTrips) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "이미 동결·확정된 이벤트는 재계산할 수 없습니다." });
            }
          }

          const capPricePerSeat = event.autoMatchPricePerSeat ?? 0;
          if (input.finalPricePerSeat !== undefined && input.finalPricePerSeat > capPricePerSeat) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `최종 가격은 상한가(${capPricePerSeat}원) 이하여야 합니다.`,
            });
          }

          try {
            const { output, createdTripCount, matchedRequestCount } = await executeMatching({
              eventId: input.eventId,
              creatorId: ctx.user.id,
              params: input.params,
              finalPricePerSeat: input.finalPricePerSeat,
            });
            // Spread the pipeline output so the admin UI renders the same
            // cluster/route preview it showed before committing.
            return { ...output, createdTripCount, matchedRequestCount };
          } catch (error) {
            if (error instanceof MatchingError) {
              throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
            }
            throw error;
          }
        }),

      freeze: adminProcedure
        .input(z.object({ eventId: z.number() }))
        .mutation(async ({ input }) => {
          const event = await getEventById(input.eventId);
          if (!event) throw new TRPCError({ code: "NOT_FOUND" });
          if (event.matchingFrozenAt) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "이미 동결된 이벤트입니다." });
          }

          // Refund every still-unmatched request, then mark the event frozen
          // (shared with the D-7 auto scheduler via refundUnmatchedRideRequests).
          const { refundedCount, refundFailures } = await refundUnmatchedRideRequests(
            input.eventId,
            "배차 동결 미매칭 환불"
          );

          await updateEvent(input.eventId, { matchingFrozenAt: new Date(), matchingFrozenBy: "admin" });

          await notifyOwner({
            title: `[번개GO] ${event.title} 배차 동결 완료`,
            content: `동결 시점 미매칭 ${refundedCount}건 환불 처리되었습니다.${refundFailures > 0 ? ` (토스 환불 실패 ${refundFailures}건 - 수동 처리 필요)` : ""}`,
          }).catch(() => false);

          return { success: true, refundedCount, refundFailures };
        }),
    }),

    // ─── Admin content editing/deletion (owner-agnostic) ─────────────────────
    events: router({
      // Full-field event edit. Admin can edit any member's event.
      update: adminProcedure
        .input(
          z.object({
            id: z.number(),
            title: z.string().min(2).optional(),
            category: z.enum(["concert", "sports", "festival", "rally", "exhibition", "other", "local_festival", "expo", "fair", "forum"]).optional(),
            eventDate: z.number().optional(),
            venue: z.string().min(2).optional(),
            address: z.string().optional(),
            imageUrl: z.string().optional(),
            description: z.string().optional(),
            organizerName: z.string().optional(),
            searchAliases: z.string().max(500).optional(),
            tags: z.string().max(500).optional(),
          })
        )
        .mutation(async ({ input, ctx }) => {
          const { id, eventDate, ...rest } = input;
          const event = await getEventById(id);
          if (!event) throw new TRPCError({ code: "NOT_FOUND" });
          await updateEvent(id, {
            ...rest,
            ...(eventDate !== undefined ? { eventDate: new Date(eventDate) } : {}),
          });
          auditLog(ctx.user.id, "event.update", { type: "event", id }, { fields: Object.keys(rest) });
          return { success: true };
        }),

      // Delete policy:
      //  - hard=true: permanent delete, only when the event has zero
      //    reservations (unchanged).
      //  - soft path with no reservations: mark "deleted".
      //  - soft path with reservations: refuse to "just delete" — return the
      //    impact and require confirmCascade, then refund everyone in full +
      //    notify them + soft-delete, as one set.
      delete: adminProcedure
        .input(z.object({ id: z.number(), hard: z.boolean().default(false), confirmCascade: z.boolean().default(false) }))
        .mutation(async ({ input, ctx }) => {
          const event = await getEventById(input.id);
          if (!event) throw new TRPCError({ code: "NOT_FOUND" });

          if (input.hard) {
            const reservationCount = await countReservationsByEventId(input.id);
            if (reservationCount > 0) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: `예약 ${reservationCount}건이 연결되어 있어 완전 삭제할 수 없습니다. 먼저 셔틀/예약을 정리하세요.`,
              });
            }
            await deleteEventCascade(input.id);
            auditLog(ctx.user.id, "event.delete.hard", { type: "event", id: input.id });
            return { mode: "hard" as const };
          }

          const impact = await getEventDeletionImpact(input.id);

          // No reservations → plain soft delete.
          if (impact.reservationCount === 0) {
            await updateEventStatus(input.id, "deleted");
            auditLog(ctx.user.id, "event.delete.soft", { type: "event", id: input.id });
            return { mode: "soft" as const };
          }

          // Has reservations but not yet confirmed → return the impact so the
          // client can warn before the cascade.
          if (!input.confirmCascade) {
            return {
              mode: "needsConfirm" as const,
              tripCount: impact.tripCount,
              reservationCount: impact.reservationCount,
              totalRefund: impact.totalRefund,
            };
          }

          // Confirmed cascade: transactional refunds + soft-delete, then the
          // external side effects (Toss cancels, notifications) post-commit.
          const cascade = await cascadeDeleteEventWithRefunds(input.id);

          for (const job of cascade.tossRefundJobs) {
            try {
              await cancelTossPayment({
                paymentKey: job.paymentKey,
                cancelReason: "이벤트 삭제 전액 환불",
                idempotencyKey: `event-delete-${job.paymentId}`,
              });
            } catch (error) {
              console.error(`[admin.events.delete] toss cancel failed for payment ${job.paymentId}:`, error);
              await notifyOwner({
                title: "[번개GO] 이벤트 삭제 토스 환불 실패 - 수동 처리 필요",
                content: `${event.title} / payment #${job.paymentId} (${job.amount}원) 환불에 실패했습니다.`,
              }).catch(() => false);
            }
          }

          const notified = await notifyEventCancellation(cascade.recipients, event.title).catch((error) => {
            console.error("[admin.events.delete] notifyEventCancellation failed:", error);
            return { sentCount: 0, failedCount: cascade.recipients.length };
          });

          auditLog(ctx.user.id, "event.delete.cascade", { type: "event", id: input.id }, {
            trips: cascade.tripCount,
            reservationsRefunded: cascade.reservationCount,
            totalRefund: cascade.totalRefund,
            pointsRefunded: cascade.pointsRefunded,
            notified: notified.sentCount,
          });

          return {
            mode: "cascade" as const,
            reservationCount: cascade.reservationCount,
            totalRefund: cascade.totalRefund,
            pointsRefunded: cascade.pointsRefunded,
            notifiedCount: notified.sentCount,
          };
        }),
    }),

    trips: router({
      // Trip-level edit. A confirmed trip's riders were already notified, so
      // changing its price requires an explicit forceConfirmedEdit flag; the
      // client shows a warning first.
      update: adminProcedure
        .input(
          z
            .object({
              id: z.number(),
              mode: z.enum(["bus", "van"]).optional(),
              minCount: z.number().min(1).optional(),
              maxCount: z.number().min(1).optional(),
              price: z.number().min(0).max(1_000_000, "1인당 요금은 100만원을 초과할 수 없습니다.").optional(),
              // null = 편도 탑승권 판매 중지 (컬럼을 NULL로 되돌림).
              oneWayPrice: z.number().min(0).max(1_000_000).nullable().optional(),
              departureAt: z.number().optional(),
              isRoundTrip: z.boolean().optional(),
              notes: z.string().optional(),
              forceConfirmedEdit: z.boolean().default(false),
            })
            .refine((d) => d.minCount === undefined || d.maxCount === undefined || d.minCount <= d.maxCount, {
              message: "최소 인원은 최대 인원보다 클 수 없습니다.",
              path: ["minCount"],
            })
        )
        .mutation(async ({ input, ctx }) => {
          const { id, forceConfirmedEdit, departureAt, ...rest } = input;
          const trip = await getTripById(id);
          if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "셔틀을 찾을 수 없습니다." });

          // Cross-field validation against the merged result (a partial patch
          // must still leave minCount <= maxCount).
          const nextMin = rest.minCount ?? trip.minCount;
          const nextMax = rest.maxCount ?? trip.maxCount;
          if (nextMin > nextMax) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "최소 인원은 최대 인원보다 클 수 없습니다." });
          }

          if (trip.status === "confirmed") {
            const changesPrice =
              (rest.price !== undefined && rest.price !== trip.price) ||
              (rest.oneWayPrice !== undefined && rest.oneWayPrice !== trip.oneWayPrice);
            if (changesPrice && !forceConfirmedEdit) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "확정된 노선의 가격 변경은 이미 통보된 승객에게 영향을 줍니다. 확인 후 다시 시도하세요.",
              });
            }
          }

          await updateTrip(id, {
            ...rest,
            ...(departureAt !== undefined ? { departureAt: new Date(departureAt) } : {}),
          });
          auditLog(ctx.user.id, "trip.update", { type: "trip", id }, { fields: Object.keys(rest), forced: forceConfirmedEdit });
          return { success: true };
        }),

      // Soft delete via cancel. If active reservations exist, require an
      // explicit confirmRefund — then refund everyone (cancelReservationsForTrip)
      // before cancelling the trip.
      delete: adminProcedure
        .input(z.object({ id: z.number(), confirmRefund: z.boolean().default(false) }))
        .mutation(async ({ input, ctx }) => {
          const trip = await getTripById(input.id);
          if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "셔틀을 찾을 수 없습니다." });
          if (trip.status === "cancelled") {
            return { success: true, refundedCount: 0 };
          }

          // Payment-flattened view: raw reservation rows have no status, so the
          // "active" set is those whose (latest) payment is still paid — exactly
          // the ones cancelReservationsForTrip will refund.
          const tripReservations = await getReservationsWithPaymentsByTripId(input.id);
          const active = tripReservations.filter((r) => r.status === "paid");

          if (active.length > 0 && !input.confirmRefund) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `이 노선에 예약 ${active.length}건이 있습니다. 삭제하면 예약자 전원에게 환불됩니다. 확인 후 진행하세요.`,
            });
          }

          if (active.length > 0) {
            await cancelReservationsForTrip(trip);
          }
          await updateTripStatus(input.id, "cancelled", "admin_cancel");
          auditLog(ctx.user.id, "trip.delete", { type: "trip", id: input.id }, { refundedCount: active.length });
          return { success: true, refundedCount: active.length };
        }),
    }),

    boardingPoints: router({
      update: adminProcedure
        .input(
          z.object({
            id: z.number(),
            name: z.string().min(1).optional(),
            address: z.string().optional(),
            lat: z.string().optional(),
            lng: z.string().optional(),
            pickupTime: z.number().nullable().optional(),
          })
        )
        .mutation(async ({ input, ctx }) => {
          const { id, pickupTime, ...rest } = input;
          const bp = await getBoardingPointById(id);
          if (!bp) throw new TRPCError({ code: "NOT_FOUND", message: "정류장을 찾을 수 없습니다." });
          await updateBoardingPoint(id, {
            ...rest,
            ...(pickupTime !== undefined ? { pickupTime: pickupTime === null ? null : new Date(pickupTime) } : {}),
          });
          auditLog(ctx.user.id, "boardingPoint.update", { type: "boardingPoint", id });
          return { success: true };
        }),

      delete: adminProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input, ctx }) => {
          const bp = await getBoardingPointById(input.id);
          if (!bp) throw new TRPCError({ code: "NOT_FOUND", message: "정류장을 찾을 수 없습니다." });
          await deleteBoardingPoint(input.id);
          auditLog(ctx.user.id, "boardingPoint.delete", { type: "boardingPoint", id: input.id });
          return { success: true };
        }),
    }),
  }),
});

export type AppRouter = typeof appRouter;
