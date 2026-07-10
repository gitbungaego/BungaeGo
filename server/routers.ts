import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { notifyOwner } from "./_core/notification";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  addPoints,
  assignRideRequestsToCluster,
  clearRideRequestClusterAssignments,
  clearRideRequestsByTripId,
  confirmTripIfCollecting,
  createBoardingPoint,
  createCluster,
  createEvent,
  createPaymentWithItems,
  createReferral,
  createReservation,
  createRideRequest,
  createStopCandidate,
  createTrip,
  decrementTripCount,
  deleteBoardingPoint,
  deleteBoardingPointsByTripId,
  deleteClustersByEventId,
  deleteReservationsByTripId,
  deleteTrip,
  ensureReferralCode,
  finalizeRideRequestRoute,
  getActiveRallyPointCandidates,
  getActiveStopCandidates,
  getAllEvents,
  getAllReservations,
  getAllStopCandidates,
  getAllTrips,
  getAllUsers,
  getBoardingPointById,
  getBoardingPointsByEventId,
  getBoardingPointsByTripId,
  getBusAccessibleRallyPointCandidates,
  getEventById,
  getEvents,
  getLatestPaymentByReservationId,
  getPaidPaymentItemTotalsByType,
  getPaymentByOrderId,
  getPaymentItemsByPaymentId,
  getPendingRideRequestsByEventId,
  getPointsByUserId,
  getReferralByPair,
  getReferralByReservationId,
  getReferralsByUserId,
  getReservationById,
  getReservationsByUserId,
  getReservationsWithPaymentsByTripId,
  getRideRequestById,
  getRideRequestOriginsByEventId,
  getRideRequestsByEventId,
  getRideRequestsByUserId,
  getTripById,
  getTripsByEventId,
  getUserByOpenId,
  getUserByReferralCode,
  incrementTripCount,
  reserveSeatsWithLock,
  setStopCandidateActive,
  updateCluster,
  updateEvent,
  updateEventStatus,
  updatePaymentStatus,
  updateReferralStatus,
  updateRideRequestStatus,
  updateTripStatus,
  updateUserStatus,
} from "./db";
import { buildFareItems, cancelReservationsForTrip, computeRefundableAmount, refundTossPaymentIfNeeded } from "./payments";
import { finalizeReservation, maybeConfirmTrip, validatePointsUsage, type TossOrderContext } from "./reservationFlow";
import { cancelTossPayment, confirmTossPayment, isTossEnabled, TossApiError } from "./toss";
import { nanoid } from "nanoid";
import { buildDemandGrid, summarizeNearbyDemand } from "./demand";
import { CONSENT_VERSIONS, recordConsent } from "./consents";
import { isThemeAllowed } from "./featureFlags";
import { getPolicy } from "./matching/confirmPolicy";
import { notifyTrip } from "./notify/tripMessenger";
import { runMatchingPipeline, type PipelineParams } from "./matching/pipeline";
import { evaluateCancellation, isCreatedAfterOwnD5 } from "@shared/cancellationPolicy";
import { USER_STATUSES } from "../drizzle/schema";
import type { RideRequest, Trip } from "../drizzle/schema";

// ─── Admin guard ─────────────────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});

// ─── Matching pipeline params ─────────────────────────────────────────────────
const pipelineParamsSchema = z.object({
  bucketSizeMinutes: z.number().min(5).default(30),
  epsMeters: z.number().min(50).default(800),
  minPts: z.number().min(1).default(10),
  maxSnapDistanceMeters: z.number().min(0).default(300),
  maxCapacitySeats: z.number().min(1).default(45),
  minCapacitySeats: z.number().min(1).default(15),
  avgSpeedKmh: z.number().min(1).default(30),
  stopDwellMinutes: z.number().min(0).default(3),
  mergeMaxDetourMinutes: z.number().min(0).default(15),
  mergeMaxDetourKm: z.number().min(0).default(10),
});
const pipelineParamsInput = pipelineParamsSchema.partial().optional();

function resolvePipelineParams(input?: z.infer<typeof pipelineParamsInput>): PipelineParams {
  return pipelineParamsSchema.parse(input ?? {});
}

// Re-exported for existing importers; implementation moved to
// server/reservationFlow.ts so the Toss confirm path can share it.
export { validatePointsUsage } from "./reservationFlow";

async function withAvailability(trip: Trip) {
  const policy = getPolicy(trip.theme);
  const tripReservations = await getReservationsWithPaymentsByTripId(trip.id);
  return { ...trip, availability: policy.availability(trip, tripReservations) };
}

// Ride requests still counted as live demand for the map: anything that
// hasn't failed/been refunded. Excludes "route_confirmed"/"boarded" -those
// riders already have a real trip, so they're no longer open demand a new
// rider would be joining.
const DEMAND_STATUSES: RideRequest["status"][] = ["pending", "clustered"];
const NEARBY_DEMAND_RADIUS_METERS = 1500;

// Combined cluster-snap candidate pool for the matching pipeline: admin-vetted
// stopCandidates plus community-sourced rallyPointCandidates marked
// busAccessible. The two tables have independent id sequences, so rally point
// ids are offset well out of stopCandidates' range before being handed to the
// pipeline - assignedStopId has no FK constraint, it's purely an opaque
// lookup key for stopNameById below.
export const RALLY_POINT_CANDIDATE_ID_OFFSET = 1_000_000;

export async function getMatchingStopCandidates(): Promise<{ id: number; lat: number; lng: number; name: string }[]> {
  const [stops, rallyPoints] = await Promise.all([
    getActiveStopCandidates(),
    getBusAccessibleRallyPointCandidates(),
  ]);
  return [
    ...stops.map((s) => ({ id: s.id, lat: Number(s.lat), lng: Number(s.lng), name: s.name })),
    ...rallyPoints.map((r) => ({
      id: RALLY_POINT_CANDIDATE_ID_OFFSET + r.id,
      lat: Number(r.lat),
      lng: Number(r.lng),
      name: r.name,
    })),
  ];
}

export const appRouter = router({
  system: systemRouter,

  // ─── Auth ──────────────────────────────────────────────────────────────────
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
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
      .query(({ input }) => getEvents(input)),

    byId: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const event = await getEventById(input.id);
        if (!event) throw new TRPCError({ code: "NOT_FOUND" });
        return event;
      }),

    create: protectedProcedure
      .input(
        z.object({
          title: z.string().min(2),
          category: z.enum(["concert", "sports", "festival", "rally", "exhibition", "other"]),
          eventDate: z.number(),
          venue: z.string().min(2),
          address: z.string().optional(),
          lat: z.string().optional(),
          lng: z.string().optional(),
          imageUrl: z.string().optional(),
          description: z.string().optional(),
          organizerName: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const id = await createEvent({
          ...input,
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

        const reservationId = await finalizeReservation(ctx.user, input, async (id) => {
          const items = buildFareItems({ fareAmount: trip.price * input.seats, pointsUsed: input.pointsUsed });
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

        return { success: true };
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
        const res = await getReservationById(input.id);
        if (!res) throw new TRPCError({ code: "NOT_FOUND" });
        if (res.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "이미 취소된 예약입니다." });

        const trip = await getTripById(res.tripId);
        if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "셔틀을 찾을 수 없습니다." });

        const now = new Date();
        const payment = await getLatestPaymentByReservationId(res.id);
        if (payment) {
          const items = await getPaymentItemsByPaymentId(payment.id);
          // 관리자 취소는 수수료 없이 항상 전액 환불 → 토스도 전액취소.
          const refundTotal = items.reduce(
            (sum, item) => sum + computeRefundableAmount(item, trip, res.createdAt, now, "admin"),
            0
          );
          if (payment.status === "paid") {
            try {
              await refundTossPaymentIfNeeded(payment, refundTotal, "관리자 취소 전액 환불");
            } catch (error) {
              console.error(`[reservations.adminCancel] toss refund failed for payment ${payment.id}:`, error);
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "토스 환불 처리에 실패했습니다. 잠시 후 다시 시도해주세요.",
              });
            }
          }
          await updatePaymentStatus(payment.id, "cancelled", {
            cancelledAt: now,
            cancelReason: "admin",
            cancelNote: `관리자(#${ctx.user.id}) 취소${input.reason ? `: ${input.reason}` : ""} (환불액 ${refundTotal}원)`,
          });
        }
        await decrementTripCount(res.tripId, res.seats);

        if (res.pointsUsed > 0) {
          await addPoints(res.userId, res.pointsUsed, "refund", "관리자 취소로 인한 포인트 환불", String(res.id));
        }

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
        z.object({
          tripId: z.number(),
          boardingPointId: z.number().optional(),
          seats: z.number().min(1).max(8),
          passengerName: z.string().min(1),
          passengerPhone: z.string().min(1),
          passengerEmail: z.string().email().optional(),
          pointsUsed: z.number().min(0).default(0),
          referralCode: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (!isTossEnabled()) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "토스 결제가 설정되지 않았습니다." });
        }
        if (ctx.user.status === "suspended") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "정지된 계정은 예약을 생성할 수 없습니다. 고객센터로 문의해주세요.",
          });
        }

        const trip = await getTripById(input.tripId);
        if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "셔틀을 찾을 수 없습니다." });

        validatePointsUsage(input.pointsUsed, ctx.user.pointsBalance, trip.price * input.seats);

        // Soft availability check so a sold-out trip fails before the user
        // reaches the payment window; the binding check is the seat lock
        // inside confirmToss → finalizeReservation.
        const { availability } = await withAvailability(trip);
        if (input.seats > availability.remaining) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "좌석이 부족합니다." });
        }

        const fareAmount = trip.price * input.seats;
        const amount = fareAmount - input.pointsUsed;
        if (amount < 100) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "토스 결제 최소 금액(100원) 미만입니다. 포인트 사용액을 조정해주세요.",
          });
        }

        const event = await getEventById(trip.eventId);
        // Toss orderId: 6-64 chars of [A-Za-z0-9-_=]; nanoid's default
        // alphabet is a subset of that.
        const orderId = `bungae-${nanoid(21)}`;
        const context: TossOrderContext = {
          kind: "reservation",
          userId: ctx.user.id,
          tripId: input.tripId,
          boardingPointId: input.boardingPointId,
          seats: input.seats,
          passengerName: input.passengerName,
          passengerPhone: input.passengerPhone,
          passengerEmail: input.passengerEmail,
          pointsUsed: input.pointsUsed,
          referralCode: input.referralCode,
        };
        await createPaymentWithItems({
          reservationId: null,
          method: "toss",
          chargeType: "prepaid",
          status: "pending",
          orderId,
          orderContext: context,
          items: buildFareItems({ fareAmount, pointsUsed: input.pointsUsed }),
        });

        return {
          orderId,
          amount,
          orderName: `${event?.title ?? "셔틀"} ${input.seats}석`.slice(0, 100),
        };
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
        if (payment.status === "paid" && payment.reservationId) {
          return { kind: context.kind, reservationId: payment.reservationId };
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

        // 승인 "전" 좌석 소프트 체크: 매진이 확실하면 과금 자체를 막는다.
        // (최종 확정은 승인 후 좌석 락 안에서 다시 검증된다.)
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
          const reservationId = await finalizeReservation(ctx.user, context, async (id) => {
            await updatePaymentStatus(payment.id, "paid", {
              paidAt: new Date(),
              tossPaymentKey: tossPayment.paymentKey,
              reservationId: id,
            });
          });
          return { kind: "reservation" as const, reservationId };
        } catch (error) {
          // attachPayment 이후(예약 커밋 이후)의 부수 단계에서 실패한 경우
          // 예약 자체는 성공했으므로 결제를 취소하면 안 된다.
          const current = await getPaymentByOrderId(input.orderId);
          if (current?.status === "paid" && current.reservationId) {
            console.error("[payments.confirmToss] post-reservation step failed (kept):", error);
            return { kind: "reservation" as const, reservationId: current.reservationId };
          }

          // 승인됐는데 좌석 확보 실패(경쟁 상황): 즉시 전액 자동 취소.
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

        // Price is always computed server-side from the event's fixed price,
        // never trusted from the client, to prevent price tampering.
        const fareAmount = event.autoMatchPricePerSeat * input.seats;
        validatePointsUsage(input.pointsUsed, ctx.user.pointsBalance, fareAmount);
        const totalAmount = fareAmount - input.pointsUsed;

        let referrerId: number | undefined;
        if (input.referralCode) {
          const referrer = await getUserByReferralCode(input.referralCode);
          if (referrer && referrer.id !== ctx.user.id) {
            referrerId = referrer.id;
          }
        }

        const requestId = await createRideRequest({
          eventId: input.eventId,
          userId: ctx.user.id,
          originAddress: input.originAddress,
          originLat: input.originLat,
          originLng: input.originLng,
          targetArrivalAt: new Date(input.targetArrivalAt),
          seats: input.seats,
          totalAmount,
          pointsUsed: input.pointsUsed,
          passengerName: input.passengerName,
          passengerPhone: input.passengerPhone,
          passengerEmail: input.passengerEmail,
          referralCodeUsed: input.referralCode,
          paymentMethod: input.paymentMethod ?? "mock",
          status: "pending",
        });

        if (input.pointsUsed > 0) {
          await addPoints(ctx.user.id, -input.pointsUsed, "usage", "참가 신청 포인트 사용", String(requestId));
        }

        if (referrerId) {
          await createReferral({
            referrerId,
            refereeId: ctx.user.id,
            status: "completed",
          });
          await addPoints(referrerId, 2000, "referral_earn", "친구 초대 적립", String(requestId));
          await addPoints(ctx.user.id, 1000, "referral_earn", "초대 코드 사용 적립", String(requestId));
        }

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

        await updateRideRequestStatus(req.id, "failed_refunded", { refundedAt: new Date() });
        if (req.pointsUsed > 0) {
          await addPoints(req.userId, req.pointsUsed, "refund", "참가 신청 취소 포인트 환불", String(req.id));
        }

        return { success: true };
      }),
  }),

  // ─── Points ────────────────────────────────────────────────────────────────
  points: router({
    myHistory: protectedProcedure.query(({ ctx }) =>
      getPointsByUserId(ctx.user.id)
    ),
    myBalance: protectedProcedure.query(async ({ ctx }) => {
      return { balance: ctx.user.pointsBalance ?? 0 };
    }),
  }),

  // ─── Referrals ─────────────────────────────────────────────────────────────
  referrals: router({
    myCode: protectedProcedure.query(async ({ ctx }) => {
      const code = await ensureReferralCode(ctx.user.id);
      return { code };
    }),
    myList: protectedProcedure.query(({ ctx }) =>
      getReferralsByUserId(ctx.user.id)
    ),
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

  // ─── Admin ─────────────────────────────────────────────────────────────────
  admin: router({
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
        .input(z.object({ eventId: z.number(), params: pipelineParamsInput }))
        .mutation(async ({ input, ctx }) => {
          const event = await getEventById(input.eventId);
          if (!event) throw new TRPCError({ code: "NOT_FOUND" });
          if (event.matchingFrozenAt) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "이미 동결된 이벤트는 재계산할 수 없습니다." });
          }
          if (!event.lat || !event.lng) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "이벤트에 좌표(장소)가 설정되어 있지 않습니다." });
          }

          const resolvedParams = resolvePipelineParams(input.params);

          // Clear prior non-frozen pipeline output for this event so recompute
          // is idempotent: any trip this pipeline previously created (marked by
          // a non-null sourceClusterId) that never progressed past "collecting"
          // is safe to delete and rebuild.
          const existingTrips = await getTripsByEventId(input.eventId);
          for (const trip of existingTrips) {
            if (trip.sourceClusterId != null && trip.status === "collecting") {
              // Reset any requests already matched into this trip (they reach
              // "route_confirmed" within a single commit call, so they must be
              // explicitly pulled back into the pending pool here, not just the
              // narrower "clustered" case clearRideRequestClusterAssignments covers).
              await clearRideRequestsByTripId(trip.id);
              await deleteReservationsByTripId(trip.id);
              await deleteBoardingPointsByTripId(trip.id);
              await deleteTrip(trip.id);
            }
          }
          await clearRideRequestClusterAssignments(input.eventId);
          await deleteClustersByEventId(input.eventId);

          const [pendingRequests, stopCandidatesForPipeline] = await Promise.all([
            getPendingRideRequestsByEventId(input.eventId),
            getMatchingStopCandidates(),
          ]);
          const stopNameById = new Map(stopCandidatesForPipeline.map((s) => [s.id, s.name]));
          const requestById = new Map(pendingRequests.map((r) => [r.id, r]));

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
            params: resolvedParams,
          });

          // Persist clusters, tracking pipeline-internal clusterId -> DB row id
          // and -> PipelineClusterResult so route stops (which carry the
          // pipeline-internal clusterId) can be resolved back to both.
          const dbClusterIdByPipelineClusterId = new Map<number, number>();
          const clusterResultByPipelineClusterId = new Map(
            output.clusters.map((c) => [c.clusterId, c])
          );

          for (const cluster of output.clusters) {
            const dbClusterId = await createCluster({
              eventId: input.eventId,
              groupKey: cluster.groupKey,
              status: cluster.status,
              assignedStopId: cluster.assignedStopId,
              assignedLat: String(cluster.assignedLat),
              assignedLng: String(cluster.assignedLng),
              isAdHocStop: cluster.isAdHocStop,
              size: cluster.memberRequestIds.length,
            });
            dbClusterIdByPipelineClusterId.set(cluster.clusterId, dbClusterId);
            if (cluster.status !== "failed") {
              await assignRideRequestsToCluster(cluster.memberRequestIds, dbClusterId);
            }
          }

          let createdTripCount = 0;
          let matchedRequestCount = 0;

          for (const route of output.routes) {
            const firstStop = route.stops[0];
            const sourceClusterId = firstStop
              ? dbClusterIdByPipelineClusterId.get(firstStop.clusterId) ?? null
              : null;

            const tripId = await createTrip({
              eventId: input.eventId,
              mode: "bus",
              status: "collecting",
              minCount: resolvedParams.minCapacitySeats,
              maxCount: resolvedParams.maxCapacitySeats,
              price: event.autoMatchPricePerSeat ?? 0,
              departureAt: route.departureAt,
              isRoundTrip: false,
              creatorId: ctx.user.id,
              sourceClusterId,
            });

            for (const stop of route.stops) {
              const clusterResult = clusterResultByPipelineClusterId.get(stop.clusterId);
              const dbClusterId = dbClusterIdByPipelineClusterId.get(stop.clusterId) ?? null;

              const stopName = clusterResult?.assignedStopId
                ? stopNameById.get(clusterResult.assignedStopId) ?? "정류장"
                : "임시 정류장";

              const boardingPointId = await createBoardingPoint({
                tripId,
                name: stopName,
                lat: String(stop.lat),
                lng: String(stop.lng),
                pickupTime: stop.pickupTime,
                order: stop.order,
              });

              if (dbClusterId !== null) {
                await updateCluster(dbClusterId, { tripId });
              }

              const memberIds = clusterResult?.memberRequestIds ?? [];
              for (const requestId of memberIds) {
                const request = requestById.get(requestId);
                if (!request) continue;

                const reservationId = await createReservation({
                  userId: request.userId,
                  tripId,
                  boardingPointId,
                  seats: request.seats,
                  pointsUsed: 0,
                  passengerName: request.passengerName ?? undefined,
                  passengerPhone: request.passengerPhone ?? undefined,
                  passengerEmail: request.passengerEmail ?? undefined,
                  referralCode: request.referralCodeUsed ?? undefined,
                });

                await createPaymentWithItems({
                  reservationId,
                  method: "mock",
                  chargeType: "prepaid",
                  items: [{ type: "fare", amount: request.totalAmount, label: "셔틀 요금" }],
                });

                await notifyTrip(
                  tripId,
                  "reservationConfirmed",
                  { passengerName: request.passengerName ?? "고객", seats: request.seats, departureAt: route.departureAt },
                  [request.userId]
                ).catch((error) => console.warn("[admin.matching.commit] notifyTrip failed:", error));

                await incrementTripCount(tripId, request.seats);
                await maybeConfirmTrip(tripId);
                await finalizeRideRequestRoute(requestId, { tripId, boardingPointId, reservationId });
                matchedRequestCount++;
              }
            }

            createdTripCount++;
          }

          return { ...output, createdTripCount, matchedRequestCount };
        }),

      freeze: adminProcedure
        .input(z.object({ eventId: z.number() }))
        .mutation(async ({ input }) => {
          const event = await getEventById(input.eventId);
          if (!event) throw new TRPCError({ code: "NOT_FOUND" });
          if (event.matchingFrozenAt) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "이미 동결된 이벤트입니다." });
          }

          const allRequests = await getRideRequestsByEventId(input.eventId);
          const unmatched = allRequests.filter(
            (r) => r.status === "pending" || r.status === "clustered"
          );

          for (const req of unmatched) {
            await updateRideRequestStatus(req.id, "failed_refunded", { refundedAt: new Date() });
            if (req.pointsUsed > 0) {
              await addPoints(req.userId, req.pointsUsed, "refund", "배차 동결 미매칭 환불", String(req.id));
            }
          }

          await updateEvent(input.eventId, { matchingFrozenAt: new Date() });

          await notifyOwner({
            title: `[번개GO] ${event.title} 배차 동결 완료`,
            content: `동결 시점 미매칭 ${unmatched.length}건 환불 처리되었습니다.`,
          }).catch(() => false);

          return { success: true, refundedCount: unmatched.length };
        }),
    }),
  }),
});

export type AppRouter = typeof appRouter;
