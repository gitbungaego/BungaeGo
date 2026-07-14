import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { calculateAge } from "@shared/bungaeting/age";
import { GENDERS, GENDER_MODES } from "../../drizzle/schema";
import {
  createBungaetingProfile,
  createTrip,
  getActiveBungaetingTrips,
  getBungaetingPreferenceByUserId,
  getBungaetingProfileByUserId,
  getBungaetingProfilesByUserIds,
  getEventById,
  getReservationsWithPaymentsByTripId,
  getTripById,
  insertBungaetingReport,
  isDuplicateKeyError,
  upsertBungaetingPreference,
} from "../db";
import type { Trip } from "../../drizzle/schema";
import { CONSENT_VERSIONS, recordConsent } from "../consents";
import { getPolicy } from "../matching/confirmPolicy";
import { router } from "../_core/trpc";
import { loadConfirmedTripMembership } from "./access";
import { bungaetingAdminRouter } from "./adminRouter";
import { bungaetingProcedure } from "./procedure";
import { buildGenderMap, buildThemeConfig, parseBungaetingConfig } from "./policy";
import { bungaetingConfigInput } from "./tripConfigInput";
import { proposalRouter } from "./proposalRouter";
import { verificationAdapter } from "./verification";

// 성인 기준 만 나이 (spec §3-2 성인 필수). 미성년자 유입 차단은 서비스 안전의 근간.
const ADULT_AGE = 19;

const BIRTHDATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 참가자 공개 뷰 — 노출 허용 필드로 타입을 좁혀 프로필 전체 객체가 새는 걸 원천 차단.
// (실명·birthDate·gender 원본·userId·연락처·verifiedAt 등은 이 타입에 없음, spec §4-2)
interface ParticipantView {
  nickname: string;
  photoUrl: string | null;
  bio: string | null;
  blinded: boolean;
  isMe: boolean;
}

// 번개팅 회차 잔여석 계산 — 반반 모드는 성별 맵으로 byGroup("남 N·여 M") 분리.
async function withBungaetingAvailability(trip: Trip) {
  const policy = getPolicy(trip.theme);
  const reservations = await getReservationsWithPaymentsByTripId(trip.id);
  const genderByUserId = await buildGenderMap(reservations);
  const cfg = parseBungaetingConfig(trip);
  return {
    availability: policy.availability(trip, reservations, { genderByUserId }),
    genderMode: cfg.genderMode,
    ageMin: cfg.ageMin,
    ageMax: cfg.ageMax,
    feeAmount: cfg.feeAmount ?? null,
  };
}

export const bungaetingRouter = router({
  // ── 프로필 / 온보딩 ──────────────────────────────────────────────────────────
  profile: router({
    // 내 번개팅 프로필 (없으면 null → 클라이언트가 온보딩으로 유도).
    me: bungaetingProcedure.query(async ({ ctx }) => {
      const profile = await getBungaetingProfileByUserId(ctx.user.id);
      return profile ?? null;
    }),

    // 최초 1회 온보딩: mock 본인인증 → 프로필 생성 + 번개팅 약관 동의 기록.
    onboard: bungaetingProcedure
      .input(
        z.object({
          nickname: z.string().min(1).max(30),
          bio: z.string().max(200).optional(),
          // TODO(R2): 실제 업로드 전까지는 URL 입력/미사용 (spec §5, §7).
          photoUrl: z.string().max(1000).optional(),
          gender: z.enum(GENDERS),
          birthDate: z.string().regex(BIRTHDATE_RE, "생년월일은 YYYY-MM-DD 형식이어야 합니다."),
          // 번개팅 별도 약관 동의 필수 — 미동의 시 가입 불가 (spec §3-2).
          agreeTos: z.literal(true),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const existing = await getBungaetingProfileByUserId(ctx.user.id);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "이미 번개팅 프로필이 있습니다." });
        }

        // 유효한 날짜인지 확인 (정규식만으로는 2026-13-40 같은 값을 못 막는다).
        const parsed = new Date(`${input.birthDate}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime()) || input.birthDate !== parsed.toISOString().slice(0, 10)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "유효하지 않은 생년월일입니다." });
        }

        // mock 본인인증. 실제 어댑터는 인증 기관에서 성별/생년월일을 받아오므로
        // 여기서 클라이언트 입력을 그대로 신뢰하지 않게 된다 (TODO: 포트원).
        const verification = await verificationAdapter.verify({
          gender: input.gender,
          birthDate: input.birthDate,
        });

        const age = calculateAge(verification.birthDate, new Date());
        if (age < ADULT_AGE) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "번개팅은 성인만 이용할 수 있습니다.",
          });
        }

        const now = new Date();
        const id = await createBungaetingProfile({
          userId: ctx.user.id,
          nickname: input.nickname,
          bio: input.bio,
          photoUrl: input.photoUrl,
          gender: verification.gender,
          birthDate: verification.birthDate,
          verifiedAt: verification.verifiedAt,
          verificationProvider: verification.provider,
          tosAgreedAt: now,
          status: "active",
        });

        await recordConsent(ctx.user.id, "bungaeting_tos", CONSENT_VERSIONS.bungaeting_tos);
        return { id };
      }),
  }),

  // ── 선호 등록 (조건 맞는 회차 오픈 시 SMS 알림용, spec §2) ──────────────────────
  preferences: router({
    get: bungaetingProcedure.query(async ({ ctx }) => {
      const pref = await getBungaetingPreferenceByUserId(ctx.user.id);
      return pref ?? null;
    }),

    upsert: bungaetingProcedure
      .input(
        z.object({
          preferredGenderMode: z.enum(GENDER_MODES).nullable().optional(),
          preferredAgeMin: z.number().int().min(0).max(120).nullable().optional(),
          preferredAgeMax: z.number().int().min(0).max(120).nullable().optional(),
          preferredRegion: z.string().max(100).nullable().optional(),
          preferredTheme: z.string().max(100).nullable().optional(),
          smsOptIn: z.boolean(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (
          input.preferredAgeMin != null &&
          input.preferredAgeMax != null &&
          input.preferredAgeMin > input.preferredAgeMax
        ) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "나이 범위가 올바르지 않습니다." });
        }
        await upsertBungaetingPreference(ctx.user.id, {
          preferredGenderMode: input.preferredGenderMode ?? null,
          preferredAgeMin: input.preferredAgeMin ?? null,
          preferredAgeMax: input.preferredAgeMax ?? null,
          preferredRegion: input.preferredRegion ?? null,
          preferredTheme: input.preferredTheme ?? null,
          smsOptIn: input.smsOptIn,
        });
        return { success: true } as const;
      }),
  }),

  // ── 회차 목록/상세 (spec §3-1, §3-3) ──────────────────────────────────────────
  trips: router({
    // 회차 생성 — 셔틀 만들기의 "번개팅 모드" 토글에서 호출. 로그인 사용자 누구나
    // 가능(생성자 = 그 회차 오픈채팅 운영자). themeConfig 검증은 buildThemeConfig 공유.
    create: bungaetingProcedure
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
          ...bungaetingConfigInput,
        }).refine((d) => d.minCount <= d.maxCount, {
          message: "최소 인원이 최대 인원보다 클 수 없습니다.",
          path: ["minCount"],
        })
      )
      .mutation(async ({ input, ctx }) => {
        const event = await getEventById(input.eventId);
        if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "이벤트를 찾을 수 없습니다." });
        const themeConfig = buildThemeConfig(input); // 검증 포함(BAD_REQUEST)
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

    // 홈: 아직 출발 안 한 번개팅 회차 + 잔여석(반반은 성별 분리).
    list: bungaetingProcedure.query(async () => {
      const items = await getActiveBungaetingTrips();
      return Promise.all(
        items.map(async ({ trip, event }) => ({
          id: trip.id,
          eventId: event.id,
          eventTitle: event.title,
          venue: event.venue,
          eventDate: event.eventDate,
          departureAt: trip.departureAt,
          price: trip.price,
          minCount: trip.minCount,
          maxCount: trip.maxCount,
          ...(await withBungaetingAvailability(trip)),
        }))
      );
    }),

    byId: bungaetingProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const trip = await getTripById(input.id);
        if (!trip || trip.theme !== "bungaeting") {
          throw new TRPCError({ code: "NOT_FOUND", message: "번개팅 회차를 찾을 수 없습니다." });
        }
        return {
          id: trip.id,
          eventId: trip.eventId,
          departureAt: trip.departureAt,
          returnAt: trip.returnAt,
          price: trip.price,
          status: trip.status,
          minCount: trip.minCount,
          maxCount: trip.maxCount,
          ...(await withBungaetingAvailability(trip)),
        };
      }),

    // ── 참가자 프로필 공개 (spec §3-4, §4-3) — 가장 민감한 데이터 노출 지점 ──────
    // 3중 서버 검증: (a) 로그인(bungaetingProcedure=protected → 비로그인 UNAUTHORIZED)
    //   (b) 그 트립의 유효(비취소) 예약자 본인  (c) 트립이 confirmed(D-5 확정 후).
    // 하나라도 불충족이면 프로필을 일절 반환하지 않는다. tripId만 아는 외부인/비예약자/
    // 취소자/미확정 시점에는 nickname·photo조차 새면 안 된다.
    participants: bungaetingProcedure
      .input(z.object({ tripId: z.number() }))
      .query(async ({ input, ctx }): Promise<ParticipantView[]> => {
        // 3중 검증(멤버십+확정)은 오픈채팅 링크 조회와 공용 (loadConfirmedTripMembership).
        const { activeUserIds } = await loadConfirmedTripMembership(input.tripId, ctx.user.id);

        const profiles = await getBungaetingProfilesByUserIds(Array.from(activeUserIds));
        // status 필터: restricted는 목록 제외, blinded는 사진/소개 가림 (spec §4-4, §신고).
        // 반환은 nickname/photoUrl/bio + isMe/blinded 파생 플래그만 — 실명·생년월일·성별·
        // userId·연락처·verifiedAt 등 민감 필드는 절대 포함하지 않는다 (spec §4-2).
        return profiles
          .filter((p) => p.status !== "restricted")
          .map((p) => ({
            nickname: p.nickname,
            photoUrl: p.status === "blinded" ? null : p.photoUrl,
            bio: p.status === "blinded" ? null : p.bio,
            blinded: p.status === "blinded",
            isMe: p.userId === ctx.user.id,
          }));
      }),

    // ── 카카오 오픈채팅 링크 (spec §3-6, 축소판) ─────────────────────────────────
    // 인앱 채팅 대신 외부 카카오 오픈채팅으로 운영 — 플랫폼은 확정 참가자에게 링크만
    // 제공한다. 프로필 공개(participants)와 동일한 3중 검증(loadConfirmedTripMembership)
    // 으로 확정 트립의 유효 예약자에게만 링크를 반환한다. 비참가자/미확정엔 미노출.
    openChat: bungaetingProcedure
      .input(z.object({ tripId: z.number() }))
      .query(async ({ input, ctx }): Promise<{ openChatUrl: string | null }> => {
        const { trip } = await loadConfirmedTripMembership(input.tripId, ctx.user.id);
        return { openChatUrl: trip.openChatUrl ?? null };
      }),

    // ── 프로필 신고 (spec §3-7) — 같은 회차 참가자만 서로 신고 가능 ────────────────
    // 채팅 신고는 카카오 오픈채팅으로 이전(⑤). 여기선 프로필 신고만. 신고자·대상 모두
    // 그 회차의 유효 참가자여야 하고, 중복 신고는 UNIQUE로 무해 처리.
    reportParticipant: bungaetingProcedure
      .input(z.object({ tripId: z.number(), targetUserId: z.number(), reason: z.string().max(300).optional() }))
      .mutation(async ({ input, ctx }) => {
        const { activeUserIds } = await loadConfirmedTripMembership(input.tripId, ctx.user.id);
        if (input.targetUserId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "본인은 신고할 수 없습니다." });
        }
        if (!activeUserIds.has(input.targetUserId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "같은 회차 참가자만 신고할 수 있습니다." });
        }
        try {
          await insertBungaetingReport({
            reporterId: ctx.user.id,
            targetUserId: input.targetUserId,
            tripId: input.tripId,
            reason: input.reason,
            status: "pending",
          });
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error; // 이미 신고함 → 무해 통과
        }
        return { success: true } as const;
      }),
  }),

  // ── 회차 제안 + 찜 (spec §3-5) ────────────────────────────────────────────────
  proposals: proposalRouter,

  // ── 관리자 콘솔 (spec §7) — 회차 생성/편집·모집현황·신고처리·알림 ────────────────
  admin: bungaetingAdminRouter,
});
