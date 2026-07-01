import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  addPoints,
  createBoardingPoint,
  createEvent,
  createReferral,
  createReservation,
  createTrip,
  decrementTripCount,
  deleteBoardingPoint,
  ensureReferralCode,
  getAllEvents,
  getAllReservations,
  getAllTrips,
  getAllUsers,
  getBoardingPointsByTripId,
  getEventById,
  getEvents,
  getPointsByUserId,
  getReferralsByUserId,
  getReservationById,
  getReservationsByUserId,
  getTripById,
  getTripsByEventId,
  getUserByOpenId,
  getUserByReferralCode,
  incrementTripCount,
  updateEventStatus,
  updateReservationStatus,
  updateTripStatus,
} from "./db";

// ─── Admin guard ─────────────────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});

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
          category: z.enum(["concert", "sports", "festival", "awards", "exhibition", "other"]),
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

    adminList: adminProcedure.query(() => getAllEvents()),
  }),

  // ─── Trips ─────────────────────────────────────────────────────────────────
  trips: router({
    byEventId: publicProcedure
      .input(z.object({ eventId: z.number() }))
      .query(({ input }) => getTripsByEventId(input.eventId)),

    byId: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const trip = await getTripById(input.id);
        if (!trip) throw new TRPCError({ code: "NOT_FOUND" });
        return trip;
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
        await updateTripStatus(input.id, input.status);
        return { success: true };
      }),

    adminList: adminProcedure.query(() => getAllTrips()),
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
        if (trip.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "취소된 셔틀입니다." });
        if (trip.currentCount + input.seats > trip.maxCount) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "좌석이 부족합니다." });
        }

        const totalAmount = trip.price * input.seats - input.pointsUsed;

        // Handle referral
        let referrerId: number | undefined;
        if (input.referralCode) {
          const referrer = await getUserByReferralCode(input.referralCode);
          if (referrer && referrer.id !== ctx.user.id) {
            referrerId = referrer.id;
          }
        }

        const reservationId = await createReservation({
          userId: ctx.user.id,
          tripId: input.tripId,
          boardingPointId: input.boardingPointId,
          seats: input.seats,
          totalAmount,
          pointsUsed: input.pointsUsed,
          passengerName: input.passengerName,
          passengerPhone: input.passengerPhone,
          passengerEmail: input.passengerEmail,
          referralCode: input.referralCode,
          paymentMethod: input.paymentMethod ?? "mock",
          status: "paid",
        });

        // Increment trip count & auto-confirm
        await incrementTripCount(input.tripId, input.seats);

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

        await updateReservationStatus(res.id, "cancelled", {
          cancelledAt: new Date(),
          cancelReason: input.reason,
        });
        await decrementTripCount(res.tripId, res.seats);

        // Refund points used
        if (res.pointsUsed > 0) {
          await addPoints(ctx.user.id, res.pointsUsed, "refund", "예약 취소 포인트 환불", String(res.id));
        }

        return { success: true };
      }),

    adminList: adminProcedure.query(() => getAllReservations()),
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

  // ─── Admin ─────────────────────────────────────────────────────────────────
  admin: router({
    users: adminProcedure.query(() => getAllUsers()),
    stats: adminProcedure.query(async () => {
      const [allEvents, allTrips, allReservations, allUsers] = await Promise.all([
        getAllEvents(),
        getAllTrips(),
        getAllReservations(),
        getAllUsers(),
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
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
