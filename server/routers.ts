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
  getActiveStopCandidates,
  getAllEvents,
  getAllReservations,
  getAllStopCandidates,
  getAllTrips,
  getAllUsers,
  getBoardingPointsByTripId,
  getEventById,
  getEvents,
  getLatestPaymentByReservationId,
  getPaidPaymentItemTotalsByType,
  getPendingRideRequestsByEventId,
  getPointsByUserId,
  getReferralsByUserId,
  getReservationById,
  getReservationsByUserId,
  getReservationsWithPaymentsByTripId,
  getRideRequestById,
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
  updateRideRequestStatus,
  updateTripStatus,
} from "./db";
import { buildFareItems, cancelReservationsForTrip } from "./payments";
import { getPolicy } from "./matching/confirmPolicy";
import { notifyTrip } from "./notify/tripMessenger";
import { runMatchingPipeline, type PipelineParams } from "./matching/pipeline";
import type { Trip } from "../drizzle/schema";

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

// ─── Trip confirm policy helpers ──────────────────────────────────────────────
async function maybeConfirmTrip(tripId: number): Promise<void> {
  const trip = await getTripById(tripId);
  if (!trip) return;
  const policy = getPolicy(trip.theme);
  const tripReservations = await getReservationsWithPaymentsByTripId(tripId);
  if (!policy.canConfirm(trip, tripReservations)) return;

  // Idempotent: only the caller that actually flips collecting -> confirmed
  // gets true back, so confirm-only follow-up never double-fires when two
  // reservations for the same trip cross minCount around the same time.
  const didConfirm = await confirmTripIfCollecting(tripId);
  if (!didConfirm) return;

  const event = await getEventById(trip.eventId);
  await notifyTrip(
    tripId,
    "tripConfirmed",
    { eventTitle: event?.title ?? "셔틀", departureAt: trip.departureAt },
    "all"
  ).catch((error) => console.warn("[maybeConfirmTrip] notifyTrip failed:", error));
}

async function withAvailability(trip: Trip) {
  const policy = getPolicy(trip.theme);
  const tripReservations = await getReservationsWithPaymentsByTripId(trip.id);
  return { ...trip, availability: policy.availability(trip, tripReservations) };
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
        return Promise.all(tripsForEvent.map(withAvailability));
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
        z.object({
          eventId: z.number(),
          mode: z.enum(["bus", "van"]).default("bus"),
          minCount: z.number().min(1),
          maxCount: z.number().min(1),
          price: z.number().min(0),
          departureAt: z.number(),
          returnAt: z.number().optional(),
          isRoundTrip: z.boolean().default(false),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
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

        await updateTripStatus(input.id, input.status);

        if (shouldCascadeRefund) {
          await cancelReservationsForTrip(trip);
        }

        return { success: true };
      }),

    adminList: adminProcedure.query(async () => {
      const allTrips = await getAllTrips();
      return Promise.all(allTrips.map(withAvailability));
    }),
  }),

  // ─── Boarding Points ───────────────────────────────────────────────────────
  boardingPoints: router({
    byTripId: publicProcedure
      .input(z.object({ tripId: z.number() }))
      .query(({ input }) => getBoardingPointsByTripId(input.tripId)),

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
      .mutation(async ({ input }) => {
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
        const trip = await getTripById(input.tripId);
        if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "셔틀을 찾을 수 없습니다." });

        // Handle referral (doesn't touch seat capacity, safe outside the lock)
        let referrerId: number | undefined;
        if (input.referralCode) {
          const referrer = await getUserByReferralCode(input.referralCode);
          if (referrer && referrer.id !== ctx.user.id) {
            referrerId = referrer.id;
          }
        }

        // Seat validation + reservation insert run inside a single transaction
        // with the trip row locked (SELECT ... FOR UPDATE), so two concurrent
        // requests for the last seat can't both read "1 remaining" and both
        // succeed — the second waits for the lock and re-validates against
        // the first's already-committed seat count.
        const reservationId = await reserveSeatsWithLock(input.tripId, async ({ trip: lockedTrip, reservations: tripReservations, insertReservation, incrementCount }) => {
          const policy = getPolicy(lockedTrip.theme);

          const reserveCheck = policy.canReserve(lockedTrip, tripReservations, ctx.user);
          if (!reserveCheck.ok) {
            throw new TRPCError({ code: "BAD_REQUEST", message: reserveCheck.reason });
          }
          if (input.seats > policy.availability(lockedTrip, tripReservations).remaining) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "좌석이 부족합니다." });
          }

          const id = await insertReservation({
            userId: ctx.user.id,
            boardingPointId: input.boardingPointId,
            seats: input.seats,
            pointsUsed: input.pointsUsed,
            passengerName: input.passengerName,
            passengerPhone: input.passengerPhone,
            passengerEmail: input.passengerEmail,
            referralCode: input.referralCode,
          });
          await incrementCount(input.seats);
          return id;
        });

        const items = buildFareItems({ fareAmount: trip.price * input.seats, pointsUsed: input.pointsUsed });
        await createPaymentWithItems({ reservationId, method: "mock", chargeType: "prepaid", items });

        await notifyTrip(
          input.tripId,
          "reservationConfirmed",
          { passengerName: input.passengerName, seats: input.seats, departureAt: trip.departureAt },
          [ctx.user.id]
        ).catch((error) => console.warn("[reservations.create] notifyTrip failed:", error));

        // Auto-confirm if this reservation reached minCount
        await maybeConfirmTrip(input.tripId);

        // Deduct points used
        if (input.pointsUsed > 0) {
          await addPoints(ctx.user.id, -input.pointsUsed, "usage", "예약 포인트 사용", String(reservationId));
        }

        // Referral points
        if (referrerId) {
          await createReferral({
            referrerId,
            refereeId: ctx.user.id,
            reservationId,
            status: "completed",
          });
          await addPoints(referrerId, 2000, "referral_earn", "친구 초대 적립", String(reservationId));
          await addPoints(ctx.user.id, 1000, "referral_earn", "초대 코드 사용 적립", String(reservationId));
        }

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

        const payment = await getLatestPaymentByReservationId(res.id);
        if (payment) {
          await updatePaymentStatus(payment.id, "cancelled", {
            cancelledAt: new Date(),
            cancelReason: "user_request",
            cancelNote: input.reason,
          });
        }
        await decrementTripCount(res.tripId, res.seats);

        // Refund points used
        if (res.pointsUsed > 0) {
          await addPoints(ctx.user.id, res.pointsUsed, "refund", "예약 취소 포인트 환불", String(res.id));
        }

        return { success: true };
      }),

    adminList: adminProcedure.query(() => getAllReservations()),
  }),

  // ─── Ride Requests (pre-matching signup, auto-match events) ──────────────────
  rideRequests: router({
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
        const totalAmount = event.autoMatchPricePerSeat * input.seats - input.pointsUsed;

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

  // ─── Admin ─────────────────────────────────────────────────────────────────
  admin: router({
    users: adminProcedure.query(() => getAllUsers()),
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

          const [pendingRequests, activeStops] = await Promise.all([
            getPendingRideRequestsByEventId(input.eventId),
            getActiveStopCandidates(),
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
            stopCandidates: activeStops.map((s) => ({
              id: s.id,
              lat: Number(s.lat),
              lng: Number(s.lng),
              name: s.name,
            })),
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

          const [pendingRequests, activeStops] = await Promise.all([
            getPendingRideRequestsByEventId(input.eventId),
            getActiveStopCandidates(),
          ]);
          const stopNameById = new Map(activeStops.map((s) => [s.id, s.name]));
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
            stopCandidates: activeStops.map((s) => ({
              id: s.id,
              lat: Number(s.lat),
              lng: Number(s.lng),
              name: s.name,
            })),
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
