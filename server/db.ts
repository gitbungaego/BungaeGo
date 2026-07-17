import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool, type PoolOptions } from "mysql2/promise";
import {
  BoardingPoint,
  BungaetingPreference,
  BungaetingProfile,
  BungaetingProposalInterest,
  BungaetingReport,
  BungaetingTripProposal,
  ChargeType,
  Cluster,
  Consent,
  Event,
  InsertBoardingPoint,
  InsertBungaetingPreference,
  InsertBungaetingProfile,
  InsertBungaetingProposalInterest,
  InsertBungaetingReport,
  InsertBungaetingTripProposal,
  InsertCluster,
  InsertConsent,
  InsertEvent,
  InsertEventRequest,
  InsertShuttleDemand,
  EventRequest,
  ShuttleDemand,
  InsertPoint,
  InsertReferral,
  InsertReservation,
  InsertRideRequest,
  InsertStopCandidate,
  InsertTrip,
  InsertUser,
  InsertReferralEntry,
  Payment,
  PaymentCancelReason,
  PaymentItem,
  PaymentItemType,
  PaymentMethod,
  Point,
  PointTransaction,
  PointTxType,
  RallyPointCandidate,
  Referral,
  ReferralEntry,
  Reservation,
  RideRequest,
  StopCandidate,
  Trip,
  TripCancelReason,
  User,
  UserStatus,
  boardingPoints,
  bungaetingPreferences,
  bungaetingProfiles,
  bungaetingProposalInterests,
  bungaetingReports,
  bungaetingTripProposals,
  clusters,
  consents,
  eventLikes,
  eventRequests,
  events,
  paymentItems,
  payments,
  pointInterests,
  pointTransactions,
  points,
  rallyPointCandidates,
  referralEntries,
  referrals,
  rewardConfig,
  reservations,
  rideRequests,
  shuttleDemands,
  stopCandidates,
  trips,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { nanoid } from "nanoid";
import type { PipelineOutput } from "./matching/pipeline";
import { escapeLikePattern, normalizeSearchTerm } from "./search";
import { computeReferralReward } from "@shared/referralReward";

let _db: ReturnType<typeof createMysqlDb> | null = null;

const RECOVERABLE_MYSQL_ERROR_CODES = new Set([
  "ER_NO_SUCH_TABLE",
  "ER_BAD_TABLE_ERROR",
  "ER_BAD_FIELD_ERROR",
  "ER_BAD_DB_ERROR",
  "ER_ACCESS_DENIED_ERROR",
  "ER_DBACCESS_DENIED_ERROR",
  "ER_TABLEACCESS_DENIED_ERROR",
  "ER_SPECIFIC_ACCESS_DENIED_ERROR",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "PROTOCOL_CONNECTION_LOST",
]);

// Drizzle wraps the real driver error as `DrizzleQueryError(message, params, cause)`,
// so the recoverable MySQL error code/message lives in `.cause`, not on the
// outer error itself. Walk the chain so wrapped errors are classified correctly.
function getErrorChain(error: unknown, depth = 0): unknown[] {
  if (!error || depth > 5) return [];
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  return [error, ...getErrorChain(cause, depth + 1)];
}

export function isDuplicateKeyError(error: unknown): boolean {
  return getErrorChain(error).some((err) => {
    const code = (err as { code?: unknown } | undefined)?.code;
    if (code === "ER_DUP_ENTRY") return true;
    const message = err instanceof Error ? err.message.toLowerCase() : "";
    return message.includes("duplicate entry");
  });
}

export function isRecoverableDatabaseError(error: unknown): boolean {
  return getErrorChain(error).some((err) => {
    const code = (err as { code?: unknown } | undefined)?.code;
    if (typeof code === "string" && RECOVERABLE_MYSQL_ERROR_CODES.has(code)) return true;

    const message = err instanceof Error ? err.message : String(err);
    const text = message.toLowerCase();

    const isMissingTable =
      (text.includes("table") && text.includes("doesn't exist")) ||
      text.includes("does not exist");
    const isPermissionIssue =
      text.includes("command denied") ||
      text.includes("access denied");
    const isConnectionIssue =
      text.includes("econnreset") ||
      text.includes("econnrefused") ||
      text.includes("enotfound") ||
      text.includes("getaddrinfo");

    return isMissingTable || isPermissionIssue || isConnectionIssue || text.includes("ssl profile");
  });
}

export function buildMysqlPoolConfig(databaseUrl: string): PoolOptions {
  const parsed = new URL(databaseUrl);
  const sslParam = parsed.searchParams.get("ssl");

  let ssl: PoolOptions["ssl"] | undefined;
  if (sslParam === "true" || sslParam === "1") {
    ssl = { rejectUnauthorized: true };
  } else if (sslParam === "false" || sslParam === "0") {
    ssl = undefined;
  } else if (sslParam) {
    try {
      ssl = JSON.parse(sslParam) as PoolOptions["ssl"];
    } catch {
      ssl = undefined;
    }
  }

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\/+/, ""),
    ssl,
    connectionLimit: 10,
  };
}

function createMysqlDb(databaseUrl: string) {
  return drizzle(createPool(buildMysqlPoolConfig(databaseUrl)));
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = createMysqlDb(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<User | undefined> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return undefined;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod", "realName", "phone"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  try {
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    if (!isRecoverableDatabaseError(error)) {
      throw error;
    }
    console.warn("[Database] Upsert skipped due to recoverable DB issue", error);
    return undefined;
  }

  return getUserByOpenId(user.openId);
}

export async function updateUserStatus(userId: number, status: UserStatus): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ status }).where(eq(users.id, userId));
}

// 닉네임(표시 이름) 변경 — 마이페이지에서 자유 수정. 카카오 재로그인은 신규
// 가입이 아닌 한 name을 덮어쓰지 않으므로 여기서 바꾼 값이 유지된다.
export async function updateUserName(userId: number, name: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(users).set({ name }).where(eq(users.id, userId));
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  try {
    const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    return result[0];
  } catch (error) {
    if (!isRecoverableDatabaseError(error)) {
      throw error;
    }
    console.warn("[Database] User lookup skipped due to recoverable DB issue", error);
    return undefined;
  }
}

export async function getUserById(id: number): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  try {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  } catch (error) {
    if (!isRecoverableDatabaseError(error)) {
      throw error;
    }
    console.warn("[Database] User lookup by id skipped due to recoverable DB issue", error);
    return undefined;
  }
}

export async function ensureReferralCode(userId: number): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const user = await getUserById(userId);
  if (user?.referralCode) return user.referralCode;
  const code = nanoid(8).toUpperCase();
  await db.update(users).set({ referralCode: code }).where(eq(users.id, userId));
  return code;
}

export async function getAllUsers(): Promise<User[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt));
}

// ─── Events ───────────────────────────────────────────────────────────────────
// Columns searched for each token. LOWER() is applied to both sides because
// events.title/venue use a binary (utf8mb4_bin) collation, which would
// otherwise make "CORTIS" not match "%cortis%". searchAliases carries the
// Korean↔English spelling variants; there is no artist column, so it's skipped.
const EVENT_SEARCH_COLUMNS = [events.title, events.venue, events.searchAliases, events.tags, events.description];

export async function getEvents(opts?: {
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<Event[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(events.status, "active")];
  if (opts?.category && opts.category !== "all") {
    conditions.push(eq(events.category, opts.category as Event["category"]));
  }
  if (opts?.search) {
    // Each token must match SOMEWHERE (OR across columns); all tokens must
    // match (AND between tokens). So "코르티스 서울" needs "코르티스" in some
    // column and "서울" in some column, not necessarily the same one.
    const tokens = normalizeSearchTerm(opts.search);
    for (const token of tokens) {
      const pattern = `%${escapeLikePattern(token)}%`;
      const perColumn = EVENT_SEARCH_COLUMNS.map(
        (col) => sql`lower(${col}) like ${pattern} escape '!'`
      );
      conditions.push(or(...perColumn)!);
    }
  }
  return db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(events.eventDate)
    .limit(opts?.limit ?? 20)
    .offset(opts?.offset ?? 0);
}

export async function getEventById(id: number): Promise<Event | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return result[0];
}

// ─── Event Likes ──────────────────────────────────────────────────────────────
/**
 * Idempotent like toggle: removes the row if present, inserts it otherwise.
 * The unique (eventId, userId) index guarantees at most one row per pair even
 * under a double-tap race. Returns the resulting state + fresh count.
 */
export async function toggleEventLike(eventId: number, userId: number): Promise<{ liked: boolean; count: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const existing = await db
    .select({ id: eventLikes.id })
    .from(eventLikes)
    .where(and(eq(eventLikes.eventId, eventId), eq(eventLikes.userId, userId)))
    .limit(1);

  let liked: boolean;
  if (existing.length > 0) {
    await db.delete(eventLikes).where(eq(eventLikes.id, existing[0].id));
    liked = false;
  } else {
    try {
      await db.insert(eventLikes).values({ eventId, userId });
      liked = true;
    } catch (error) {
      // Lost a double-tap race to insert the same pair — the unique index
      // rejected the duplicate, which means it's already liked.
      if (isDuplicateKeyError(error)) {
        liked = true;
      } else {
        throw error;
      }
    }
  }

  const count = await getEventLikeCount(eventId);
  return { liked, count };
}

export async function getEventLikeCount(eventId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(eventLikes)
    .where(eq(eventLikes.eventId, eventId));
  return Number(rows[0]?.count ?? 0);
}

export async function getEventLikeCounts(eventIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (eventIds.length === 0) return map;
  const db = await getDb();
  if (!db) return map;
  const rows = await db
    .select({ eventId: eventLikes.eventId, count: sql<number>`count(*)` })
    .from(eventLikes)
    .where(inArray(eventLikes.eventId, eventIds))
    .groupBy(eventLikes.eventId);
  for (const row of rows) map.set(row.eventId, Number(row.count));
  return map;
}

/** Which of the given events the user has liked (for myLiked flags). */
export async function getLikedEventIds(userId: number, eventIds: number[]): Promise<Set<number>> {
  const set = new Set<number>();
  if (eventIds.length === 0) return set;
  const db = await getDb();
  if (!db) return set;
  const rows = await db
    .select({ eventId: eventLikes.eventId })
    .from(eventLikes)
    .where(and(eq(eventLikes.userId, userId), inArray(eventLikes.eventId, eventIds)));
  for (const row of rows) set.add(row.eventId);
  return set;
}

/** Liked events for the MyPage "찜한 이벤트" section, newest like first. */
export async function getLikedEventsByUser(userId: number): Promise<Event[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(eventLikes)
    .innerJoin(events, eq(eventLikes.eventId, events.id))
    .where(eq(eventLikes.userId, userId))
    .orderBy(desc(eventLikes.createdAt));
  return rows.map((r) => r.events);
}

// ─── Point Interests (+1 여기서 출발 원해요) ────────────────────────────────────
/**
 * Idempotent interest toggle, same pattern as toggleEventLike: remove if
 * present, insert otherwise; a lost double-tap insert race (unique index)
 * counts as already-interested. Returns the resulting state + fresh count.
 */
export async function togglePointInterest(
  eventId: number,
  rallyPointCandidateId: number,
  userId: number
): Promise<{ interested: boolean; count: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const existing = await db
    .select({ id: pointInterests.id })
    .from(pointInterests)
    .where(
      and(
        eq(pointInterests.eventId, eventId),
        eq(pointInterests.rallyPointCandidateId, rallyPointCandidateId),
        eq(pointInterests.userId, userId)
      )
    )
    .limit(1);

  let interested: boolean;
  if (existing.length > 0) {
    await db.delete(pointInterests).where(eq(pointInterests.id, existing[0].id));
    interested = false;
  } else {
    try {
      await db.insert(pointInterests).values({ eventId, rallyPointCandidateId, userId });
      interested = true;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        interested = true;
      } else {
        throw error;
      }
    }
  }

  const counts = await getPointInterestCounts(eventId);
  return { interested, count: counts.get(rallyPointCandidateId) ?? 0 };
}

/** Interest counts per candidate for one event. */
export async function getPointInterestCounts(eventId: number): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const db = await getDb();
  if (!db) return map;
  const rows = await db
    .select({ candidateId: pointInterests.rallyPointCandidateId, count: sql<number>`count(*)` })
    .from(pointInterests)
    .where(eq(pointInterests.eventId, eventId))
    .groupBy(pointInterests.rallyPointCandidateId);
  for (const row of rows) map.set(row.candidateId, Number(row.count));
  return map;
}

/** Candidate ids this user has +1'd for an event (for myInterested flags). */
export async function getInterestedCandidateIds(eventId: number, userId: number): Promise<Set<number>> {
  const set = new Set<number>();
  const db = await getDb();
  if (!db) return set;
  const rows = await db
    .select({ candidateId: pointInterests.rallyPointCandidateId })
    .from(pointInterests)
    .where(and(eq(pointInterests.eventId, eventId), eq(pointInterests.userId, userId)));
  for (const row of rows) set.add(row.candidateId);
  return set;
}

export async function createEvent(data: InsertEvent): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(events).values(data);
  return (result[0] as any).insertId;
}

export async function updateEventStatus(
  id: number,
  status: Event["status"]
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(events).set({ status }).where(eq(events.id, id));
}

export async function getAllEvents(): Promise<Event[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(events).orderBy(desc(events.createdAt));
}

export async function updateEvent(id: number, data: Partial<InsertEvent>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(events).set(data).where(eq(events.id, id));
}

/** Total reservations attached to an event (across all its trips). 0 => a hard
 *  delete is safe. */
export async function countReservationsByEventId(eventId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(reservations)
    .innerJoin(trips, eq(reservations.tripId, trips.id))
    .where(eq(trips.eventId, eventId));
  return Number(rows[0]?.n ?? 0);
}

/** Hard delete an event and everything hanging off it: reservations + their
 *  payments, boarding points, trips, clusters, ride requests, likes, then the
 *  event row. Callers must gate this on the delete policy (0 reservations). */
export async function deleteEventCascade(eventId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const eventTrips = await db.select({ id: trips.id }).from(trips).where(eq(trips.eventId, eventId));
  for (const t of eventTrips) {
    await deleteReservationsByTripId(t.id);
    await db.delete(boardingPoints).where(eq(boardingPoints.tripId, t.id));
  }
  await db.delete(trips).where(eq(trips.eventId, eventId));
  await db.delete(clusters).where(eq(clusters.eventId, eventId));
  await db.delete(rideRequests).where(eq(rideRequests.eventId, eventId));
  await db.delete(eventLikes).where(eq(eventLikes.eventId, eventId));
  await db.delete(events).where(eq(events.id, eventId));
}

// ─── Cascade soft-delete with full refunds (admin) ────────────────────────────
export interface CascadeDeleteRecipient {
  userId: number;
  reservationId: number;
  seats: number;
  passengerName: string | null;
  passengerPhone: string | null;
  passengerEmail: string | null;
}

export interface CascadeDeleteResult {
  tripCount: number;
  reservationCount: number; // paid reservations refunded
  totalRefund: number; // cash refunded (sum of paid payment totals)
  pointsRefunded: number; // total points restored
  tossRefundJobs: { paymentId: number; paymentKey: string; amount: number }[];
  recipients: CascadeDeleteRecipient[]; // deduped by userId
}

export interface CascadeDeleteHooks {
  // Test-only seam to force a mid-transaction failure and prove rollback.
  failBeforeCommit?: () => void | Promise<void>;
}

/** Read-only impact preview for the delete confirmation dialog. */
export async function getEventDeletionImpact(
  eventId: number
): Promise<{ tripCount: number; reservationCount: number; totalRefund: number }> {
  const db = await getDb();
  if (!db) return { tripCount: 0, reservationCount: 0, totalRefund: 0 };
  const eventTrips = await db.select({ id: trips.id }).from(trips).where(eq(trips.eventId, eventId));
  if (eventTrips.length === 0) return { tripCount: 0, reservationCount: 0, totalRefund: 0 };
  const resRows = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(inArray(reservations.tripId, eventTrips.map((t) => t.id)));
  const paymentsByRes = await getLatestPaymentsByReservationIds(resRows.map((r) => r.id));
  let reservationCount = 0;
  let totalRefund = 0;
  for (const p of Array.from(paymentsByRes.values())) {
    if (p.status === "paid") {
      reservationCount++;
      totalRefund += p.totalAmount;
    }
  }
  return { tripCount: eventTrips.length, reservationCount, totalRefund };
}

/**
 * Transactionally soft-deletes an event that has reservations: cancels every
 * trip, cancels every paid payment (full refund — admin/company-fault, no
 * fee, same policy as computeRefundableAmount("admin")), restores used points,
 * and marks the event "deleted" — all in ONE transaction so a mid-way failure
 * rolls the whole thing back.
 *
 * External side effects are NOT done here (executeMatching pattern): the
 * caller runs the returned Toss cancel jobs and the cancellation
 * notifications AFTER commit, since neither can be rolled back.
 */
export async function cascadeDeleteEventWithRefunds(
  eventId: number,
  hooks: CascadeDeleteHooks = {}
): Promise<CascadeDeleteResult> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const now = new Date();

  return db.transaction(async (tx) => {
    const eventTrips = await tx.select().from(trips).where(eq(trips.eventId, eventId));
    const tripIds = eventTrips.map((t) => t.id);

    const resRows = tripIds.length
      ? await tx.select().from(reservations).where(inArray(reservations.tripId, tripIds))
      : [];
    const resIds = resRows.map((r) => r.id);
    const paymentRows = resIds.length
      ? await tx.select().from(payments).where(inArray(payments.reservationId, resIds))
      : [];
    // Latest payment per reservation.
    const latestByRes = new Map<number, Payment>();
    for (const p of paymentRows) {
      if (p.reservationId === null) continue;
      const cur = latestByRes.get(p.reservationId);
      if (!cur || p.id > cur.id) latestByRes.set(p.reservationId, p);
    }

    // Cancel all trips (+ 해당 트립 미지급 추천 건 VOID — referral-credit-spec §4.4).
    for (const trip of eventTrips) {
      await tx.update(trips).set({ status: "cancelled", cancelReason: "admin_cancel" }).where(eq(trips.id, trip.id));
      await tx
        .update(referralEntries)
        .set({ status: "VOID" })
        .where(and(eq(referralEntries.tripId, trip.id), inArray(referralEntries.status, ["PENDING", "FLAGGED"])));
    }

    const result: CascadeDeleteResult = {
      tripCount: eventTrips.length,
      reservationCount: 0,
      totalRefund: 0,
      pointsRefunded: 0,
      tossRefundJobs: [],
      recipients: [],
    };
    const seenUsers = new Set<number>();

    for (const reservation of resRows) {
      const payment = latestByRes.get(reservation.id);
      if (!payment || payment.status !== "paid") continue;

      // Full refund (admin/company-fault: no cancellation fee).
      await tx
        .update(payments)
        .set({
          status: "cancelled",
          cancelledAt: now,
          cancelReason: "admin",
          cancelNote: `이벤트 삭제 전액 환불 (환불액 ${payment.totalAmount}원)`,
          refundedAmount: payment.totalAmount,
        })
        .where(eq(payments.id, payment.id));
      result.reservationCount++;
      result.totalRefund += payment.totalAmount;

      if (payment.method === "toss" && payment.tossPaymentKey) {
        result.tossRefundJobs.push({ paymentId: payment.id, paymentKey: payment.tossPaymentKey, amount: payment.totalAmount });
      }

      // Restore used points (inline, not addPoints(), to stay in this tx).
      // 통합 원장(point_transactions)에 REFUND로 기록 — 만료일 리셋 없음(spec §6).
      if (reservation.pointsUsed > 0) {
        await tx
          .update(users)
          .set({ pointsBalance: sql`${users.pointsBalance} + ${reservation.pointsUsed}` })
          .where(eq(users.id, reservation.userId));
        const [row] = await tx.select({ pointsBalance: users.pointsBalance }).from(users).where(eq(users.id, reservation.userId));
        await tx.insert(pointTransactions).values({
          userId: reservation.userId,
          type: "REFUND",
          amount: reservation.pointsUsed,
          balanceAfter: row?.pointsBalance ?? reservation.pointsUsed,
          memo: `이벤트 삭제로 인한 포인트 환불 (#${reservation.id})`,
        });
        result.pointsRefunded += reservation.pointsUsed;
      }

      if (!seenUsers.has(reservation.userId)) {
        seenUsers.add(reservation.userId);
        result.recipients.push({
          userId: reservation.userId,
          reservationId: reservation.id,
          seats: reservation.seats,
          passengerName: reservation.passengerName,
          passengerPhone: reservation.passengerPhone,
          passengerEmail: reservation.passengerEmail,
        });
      }
    }

    await tx.update(events).set({ status: "deleted" }).where(eq(events.id, eventId));

    if (hooks.failBeforeCommit) await hooks.failBeforeCommit();

    return result;
  });
}

/**
 * Atomically claim the freeze for an event: sets matchingFrozenAt/By only if
 * it is still null. Returns true iff this call won the race (affected a row).
 * The auto-freeze scheduler uses this as a preemption lock so two ticks (or a
 * tick racing an admin) can never both process the same event.
 */
export async function freezeEventIfUnfrozen(
  eventId: number,
  frozenBy: "admin" | "auto"
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db
    .update(events)
    .set({ matchingFrozenAt: new Date(), matchingFrozenBy: frozenBy })
    .where(and(eq(events.id, eventId), isNull(events.matchingFrozenAt)));
  // mysql2 returns affectedRows on the ResultSetHeader.
  return ((result[0] as any)?.affectedRows ?? 0) > 0;
}

/**
 * Auto-freeze candidates: active, auto-match-enabled events that are not yet
 * frozen. The D-7 boundary itself is applied by the caller against eventDate
 * (KST), since that lives in shared/cancellationPolicy.
 */
export async function getUnfrozenAutoMatchEvents(): Promise<Event[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(events)
    .where(
      and(
        eq(events.status, "active"),
        eq(events.autoMatchEnabled, true),
        isNull(events.matchingFrozenAt)
      )
    );
}

// ─── Trips ────────────────────────────────────────────────────────────────────
export async function getTripsByEventId(eventId: number): Promise<Trip[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(trips)
    .where(and(eq(trips.eventId, eventId)))
    .orderBy(trips.departureAt);
}

export async function getTripById(id: number): Promise<Trip | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(trips).where(eq(trips.id, id)).limit(1);
  return result[0];
}

export async function createTrip(data: InsertTrip): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(trips).values(data);
  return (result[0] as any).insertId;
}

export async function updateTripStatus(
  id: number,
  status: Trip["status"],
  cancelReason?: TripCancelReason
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const patch: Partial<Trip> = { status };
  if (cancelReason !== undefined) patch.cancelReason = cancelReason;
  await db.update(trips).set(patch).where(eq(trips.id, id));
  // 트립 취소 = 해당 트립의 미지급 추천 건 전부 VOID (referral-credit-spec §4.4).
  // 취소 경로의 단일 관문이라 여기서 처리 — 멱등(PENDING/FLAGGED만 대상).
  if (status === "cancelled") {
    await voidReferralEntriesByTripId(id).catch((error) =>
      console.error(`[updateTripStatus] referral void failed for trip ${id}:`, error)
    );
  }
}

// Admin edit of trip-level fields.
export async function updateTrip(id: number, data: Partial<InsertTrip>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(trips).set(data).where(eq(trips.id, id));
}

// Conditional UPDATE guarded by the current status: only the caller whose
// UPDATE actually flips collecting -> confirmed gets affectedRows > 0, so
// concurrent callers can safely treat this as "did I just confirm it?" and
// skip confirm-only follow-up (e.g. a future bulk-billing hook) otherwise.
export async function confirmTripIfCollecting(tripId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db
    .update(trips)
    .set({ status: "confirmed" })
    .where(and(eq(trips.id, tripId), eq(trips.status, "collecting")));
  return (result[0] as any).affectedRows > 0;
}

// Same idempotency guarantee as confirmTripIfCollecting, for the D-5
// scheduler's auto-cancel branch: only the caller that actually flips
// collecting -> cancelled gets true back, so the refund cascade and
// notification never double-fire.
export async function cancelTripIfCollecting(
  tripId: number,
  cancelReason: TripCancelReason
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db
    .update(trips)
    .set({ status: "cancelled", cancelReason })
    .where(and(eq(trips.id, tripId), eq(trips.status, "collecting")));
  const didCancel = (result[0] as any).affectedRows > 0;
  // D-5 자동취소도 추천 건 VOID (referral-credit-spec §4.4).
  if (didCancel) {
    await voidReferralEntriesByTripId(tripId).catch((error) =>
      console.error(`[cancelTripIfCollecting] referral void failed for trip ${tripId}:`, error)
    );
  }
  return didCancel;
}

export async function getTripsByStatus(status: Trip["status"]): Promise<Trip[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(trips).where(eq(trips.status, status));
}

// 번개팅 홈용: 아직 출발 안 한 모집/확정 상태의 번개팅 회차 + 이벤트 기본정보.
export interface BungaetingTripListItem {
  trip: Trip;
  event: { id: number; title: string; venue: string; eventDate: Date };
}
export async function getActiveBungaetingTrips(now: Date = new Date()): Promise<BungaetingTripListItem[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ trip: trips, eventId: events.id, title: events.title, venue: events.venue, eventDate: events.eventDate })
    .from(trips)
    .innerJoin(events, eq(trips.eventId, events.id))
    .where(
      and(
        eq(trips.theme, "bungaeting"),
        inArray(trips.status, ["collecting", "confirmed"]),
        gte(trips.departureAt, now)
      )
    )
    .orderBy(trips.departureAt);
  return rows.map((r) => ({
    trip: r.trip,
    event: { id: r.eventId, title: r.title, venue: r.venue, eventDate: r.eventDate },
  }));
}

export async function incrementTripCount(tripId: number, seats: number): Promise<Trip | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  await db
    .update(trips)
    .set({ currentCount: sql`${trips.currentCount} + ${seats}` })
    .where(eq(trips.id, tripId));
  return getTripById(tripId);
}

export async function decrementTripCount(tripId: number, seats: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(trips)
    .set({ currentCount: sql`GREATEST(0, ${trips.currentCount} - ${seats})` })
    .where(eq(trips.id, tripId));
}

// Serializes reservation creation per trip: locks the trip row with
// SELECT ... FOR UPDATE inside a transaction, reads a consistent snapshot of
// its reservations, then lets the caller validate (via ConfirmPolicy) and
// insert within the same transaction. Any concurrent call for the same trip
// blocks on the row lock until this one commits, which rules out two
// requests both reading "1 seat left" and both succeeding.
export async function reserveSeatsWithLock<T>(
  tripId: number,
  fn: (ctx: {
    trip: Trip;
    reservations: ReservationWithPayment[];
    insertReservation: (data: Omit<InsertReservation, "id" | "tripId">) => Promise<number>;
    incrementCount: (seats: number) => Promise<void>;
  }) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  return db.transaction(async (tx) => {
    const [trip] = await tx.select().from(trips).where(eq(trips.id, tripId)).for("update");
    if (!trip) {
      throw new Error(`Trip ${tripId} not found`);
    }

    const reservationRows = await tx.select().from(reservations).where(eq(reservations.tripId, tripId));
    const reservationIds = reservationRows.map((r) => r.id);
    const paymentRows = reservationIds.length
      ? await tx.select().from(payments).where(inArray(payments.reservationId, reservationIds))
      : [];
    const latestPaymentByReservationId = new Map<number, Payment>();
    for (const payment of paymentRows) {
      if (payment.reservationId === null) continue;
      const existing = latestPaymentByReservationId.get(payment.reservationId);
      if (!existing || payment.id > existing.id) {
        latestPaymentByReservationId.set(payment.reservationId, payment);
      }
    }
    const reservationsWithPayments = reservationRows.map((r) =>
      flattenReservation(r, latestPaymentByReservationId.get(r.id))
    );

    const insertReservation = async (data: Omit<InsertReservation, "id" | "tripId">): Promise<number> => {
      const qrToken = nanoid(32);
      const result = await tx.insert(reservations).values({ ...data, tripId, qrToken });
      return (result[0] as any).insertId;
    };

    const incrementCount = async (seats: number): Promise<void> => {
      await tx
        .update(trips)
        .set({ currentCount: sql`${trips.currentCount} + ${seats}` })
        .where(eq(trips.id, tripId));
    };

    return fn({ trip, reservations: reservationsWithPayments, insertReservation, incrementCount });
  });
}

export async function getAllTrips(): Promise<Trip[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(trips).orderBy(desc(trips.createdAt));
}

export async function deleteTrip(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(trips).where(eq(trips.id, id));
}

// ─── Boarding Points ──────────────────────────────────────────────────────────
export async function getBoardingPointsByTripId(tripId: number): Promise<BoardingPoint[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(boardingPoints)
    .where(eq(boardingPoints.tripId, tripId))
    .orderBy(boardingPoints.order);
}

export async function getBoardingPointById(id: number): Promise<BoardingPoint | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(boardingPoints).where(eq(boardingPoints.id, id)).limit(1);
  return result[0];
}

// All boarding points across every trip of an event, for the event-wide
// rally-point map (EventDetail's map shows every shuttle's stops at once,
// not just the selected one).
export async function getBoardingPointsByEventId(eventId: number): Promise<BoardingPoint[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: boardingPoints.id,
      tripId: boardingPoints.tripId,
      name: boardingPoints.name,
      address: boardingPoints.address,
      lat: boardingPoints.lat,
      lng: boardingPoints.lng,
      pickupTime: boardingPoints.pickupTime,
      order: boardingPoints.order,
      createdAt: boardingPoints.createdAt,
      updatedAt: boardingPoints.updatedAt,
    })
    .from(boardingPoints)
    .innerJoin(trips, eq(trips.id, boardingPoints.tripId))
    .where(eq(trips.eventId, eventId))
    .orderBy(boardingPoints.tripId, boardingPoints.order);
}

export async function createBoardingPoint(data: InsertBoardingPoint): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(boardingPoints).values(data);
  return (result[0] as any).insertId;
}

export async function deleteBoardingPoint(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(boardingPoints).where(eq(boardingPoints.id, id));
}

// Admin edit of a single boarding point (owner-agnostic).
export async function updateBoardingPoint(id: number, data: Partial<InsertBoardingPoint>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(boardingPoints).set(data).where(eq(boardingPoints.id, id));
}

export async function deleteBoardingPointsByTripId(tripId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(boardingPoints).where(eq(boardingPoints.tripId, tripId));
}

// ─── Reservations ─────────────────────────────────────────────────────────────
// `status`/`totalAmount`/`paymentMethod`/`cancelledAt`/`cancelReason` live on
// `payments` now; these accessors flatten the reservation's latest payment
// back onto the same field names so callers (routers.ts, client) are unaffected.
export type ReservationWithPayment = Reservation & {
  status: Payment["status"];
  totalAmount: number;
  paymentMethod: PaymentMethod | null;
  chargeType: ChargeType | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: PaymentCancelReason | null;
  cancelNote: string | null;
};

function flattenReservation(reservation: Reservation, payment: Payment | undefined): ReservationWithPayment {
  return {
    ...reservation,
    status: payment?.status ?? "pending",
    totalAmount: payment?.totalAmount ?? 0,
    paymentMethod: payment?.method ?? null,
    chargeType: payment?.chargeType ?? null,
    paidAt: payment?.paidAt ?? null,
    cancelledAt: payment?.cancelledAt ?? null,
    cancelReason: payment?.cancelReason ?? null,
    cancelNote: payment?.cancelNote ?? null,
  };
}

export async function getReservationsByUserId(userId: number): Promise<ReservationWithPayment[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(reservations)
    .where(eq(reservations.userId, userId))
    .orderBy(desc(reservations.createdAt));
  const paymentsByReservation = await getLatestPaymentsByReservationIds(rows.map((r) => r.id));
  return rows.map((r) => flattenReservation(r, paymentsByReservation.get(r.id)));
}

export async function getReservationById(id: number): Promise<ReservationWithPayment | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
  const reservation = result[0];
  if (!reservation) return undefined;
  const payment = await getLatestPaymentByReservationId(reservation.id);
  return flattenReservation(reservation, payment);
}

export async function createReservation(data: InsertReservation): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const qrToken = nanoid(32);
  const result = await db.insert(reservations).values({ ...data, qrToken });
  return (result[0] as any).insertId;
}

export async function getAllReservations(): Promise<ReservationWithPayment[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(reservations).orderBy(desc(reservations.createdAt));
  const paymentsByReservation = await getLatestPaymentsByReservationIds(rows.map((r) => r.id));
  return rows.map((r) => flattenReservation(r, paymentsByReservation.get(r.id)));
}

export async function getReservationsByTripId(tripId: number): Promise<Reservation[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reservations).where(eq(reservations.tripId, tripId));
}

export async function getReservationsWithPaymentsByTripId(tripId: number): Promise<ReservationWithPayment[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(reservations).where(eq(reservations.tripId, tripId));
  const paymentsByReservation = await getLatestPaymentsByReservationIds(rows.map((r) => r.id));
  return rows.map((r) => flattenReservation(r, paymentsByReservation.get(r.id)));
}

export async function deleteReservationsByTripId(tripId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const rows = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(eq(reservations.tripId, tripId));
  await deletePaymentsByReservationIds(rows.map((r) => r.id));
  await db.delete(reservations).where(eq(reservations.tripId, tripId));
}

// ─── Payments ─────────────────────────────────────────────────────────────────
export async function createPaymentWithItems(data: {
  // Null for a Toss pending order: the reservation doesn't exist yet and is
  // linked after approval.
  reservationId: number | null;
  method: PaymentMethod;
  chargeType: ChargeType;
  items: { type: PaymentItemType; amount: number; label: string }[];
  // Defaults to the legacy behavior (immediately-paid mock payment).
  status?: "pending" | "paid";
  orderId?: string;
  orderContext?: unknown;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const status = data.status ?? "paid";
  const totalAmount = data.items.reduce((sum, item) => sum + item.amount, 0);
  const result = await db.insert(payments).values({
    reservationId: data.reservationId,
    totalAmount,
    status,
    method: data.method,
    chargeType: data.chargeType,
    orderId: data.orderId,
    orderContext: data.orderContext,
    paidAt: status === "paid" ? new Date() : null,
  });
  const paymentId = (result[0] as any).insertId;
  if (data.items.length > 0) {
    await db.insert(paymentItems).values(
      data.items.map((item) => ({
        paymentId,
        type: item.type,
        amount: item.amount,
        label: item.label,
      }))
    );
  }
  return paymentId;
}

export async function getPaymentByOrderId(orderId: string): Promise<Payment | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(payments).where(eq(payments.orderId, orderId)).limit(1);
  return result[0];
}

export async function getLatestPaymentByRideRequestId(rideRequestId: number): Promise<Payment | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(payments)
    .where(eq(payments.rideRequestId, rideRequestId))
    .orderBy(desc(payments.id))
    .limit(1);
  return result[0];
}

export async function getLatestPaymentByReservationId(reservationId: number): Promise<Payment | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(payments)
    .where(eq(payments.reservationId, reservationId))
    .orderBy(desc(payments.id))
    .limit(1);
  return result[0];
}

export async function getLatestPaymentsByReservationIds(
  reservationIds: number[]
): Promise<Map<number, Payment>> {
  const map = new Map<number, Payment>();
  if (reservationIds.length === 0) return map;
  const db = await getDb();
  if (!db) return map;
  const rows = await db.select().from(payments).where(inArray(payments.reservationId, reservationIds));
  for (const row of rows) {
    if (row.reservationId === null) continue;
    const existing = map.get(row.reservationId);
    if (!existing || row.id > existing.id) {
      map.set(row.reservationId, row);
    }
  }
  return map;
}

export async function updatePaymentStatus(
  id: number,
  status: Payment["status"],
  extra?: Partial<Payment>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(payments).set({ status, ...extra }).where(eq(payments.id, id));
}

export async function getPaymentItemsByPaymentId(paymentId: number): Promise<PaymentItem[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(paymentItems).where(eq(paymentItems.paymentId, paymentId));
}

export async function getPaymentItemsByPaymentIds(paymentIds: number[]): Promise<PaymentItem[]> {
  if (paymentIds.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  return db.select().from(paymentItems).where(inArray(paymentItems.paymentId, paymentIds));
}

export async function getPaidPaymentItemTotalsByType(): Promise<Record<PaymentItemType, number>> {
  const totals: Record<PaymentItemType, number> = { fare: 0, theme_fee: 0, discount: 0 };
  const db = await getDb();
  if (!db) return totals;
  const rows = await db
    .select({ type: paymentItems.type, amount: paymentItems.amount })
    .from(paymentItems)
    .innerJoin(payments, eq(paymentItems.paymentId, payments.id))
    .where(eq(payments.status, "paid"));
  for (const row of rows) {
    totals[row.type] += row.amount;
  }
  return totals;
}

export async function deletePaymentsByReservationIds(reservationIds: number[]): Promise<void> {
  if (reservationIds.length === 0) return;
  const db = await getDb();
  if (!db) return;
  const paymentRows = await db
    .select({ id: payments.id, method: payments.method })
    .from(payments)
    .where(inArray(payments.reservationId, reservationIds));

  // 실결제(toss) 기록은 매칭 재계산으로 예약이 지워져도 삭제하면 안 된다
  // (돈이 오간 원장) - 예약 연결만 끊고 rideRequestId로 다음 커밋에서
  // 다시 연결된다. mock 결제는 기존대로 예약과 함께 삭제.
  const tossIds = paymentRows.filter((p) => p.method === "toss").map((p) => p.id);
  const deletableIds = paymentRows.filter((p) => p.method !== "toss").map((p) => p.id);

  if (tossIds.length > 0) {
    await db.update(payments).set({ reservationId: null }).where(inArray(payments.id, tossIds));
  }
  if (deletableIds.length > 0) {
    await db.delete(paymentItems).where(inArray(paymentItems.paymentId, deletableIds));
    await db.delete(payments).where(inArray(payments.id, deletableIds));
  }
}

// ─── Points ───────────────────────────────────────────────────────────────────
export async function getPointsByUserId(userId: number): Promise<Point[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(points)
    .where(eq(points.userId, userId))
    .orderBy(desc(points.createdAt));
}

// ─── Reward Config (referral-credit-spec §8 — 하드코딩 금지) ───────────────────
export interface RewardConfigValues {
  rateParticipant: number; // 동일 행사 참가자 요율
  rateDefault: number; // 비참가 홍보자 요율
  capKrw: number; // 요율 무관 공통 상한
  ttlDays: number; // 포인트 유효기간(일)
  dailyCodeEntryLimit: number; // 동일 코드 일일 신규 입력 한도
}

const REWARD_CONFIG_DEFAULTS: RewardConfigValues = {
  rateParticipant: 0.05,
  rateDefault: 0.02,
  capKrw: 5000,
  ttlDays: 365,
  dailyCodeEntryLimit: 20,
};

const REWARD_CONFIG_KEYS: Record<string, keyof RewardConfigValues> = {
  referral_rate_participant: "rateParticipant",
  referral_rate_default: "rateDefault",
  referral_cap_krw: "capKrw",
  credit_ttl_days: "ttlDays",
  daily_code_entry_limit: "dailyCodeEntryLimit",
};

let rewardConfigCache: { at: number; values: RewardConfigValues } | null = null;

// reward_config 행이 있으면 덮어쓰고, 없으면 코드 기본값. 60초 캐시.
export async function getRewardConfigValues(): Promise<RewardConfigValues> {
  if (rewardConfigCache && Date.now() - rewardConfigCache.at < 60_000) {
    return rewardConfigCache.values;
  }
  const values = { ...REWARD_CONFIG_DEFAULTS };
  const db = await getDb();
  if (db) {
    try {
      const rows = await db.select().from(rewardConfig);
      for (const row of rows) {
        const field = REWARD_CONFIG_KEYS[row.key];
        const n = Number(row.value);
        if (field && Number.isFinite(n)) values[field] = n;
      }
    } catch (error) {
      console.warn("[rewardConfig] read failed, using defaults:", error);
    }
  }
  rewardConfigCache = { at: Date.now(), values };
  return values;
}

// ─── Point Transactions (통합 원장) ────────────────────────────────────────────
// 모든 신규 적립/차감의 단일 경유점. SELECT ... FOR UPDATE로 유저 행을 잠가
// 동시 이중 사용을 직렬화하고(spec 테스트 14), 적립(EARN_*) 시 만료일을
// NOW+TTL로 전체 리셋한다 (spec §6 — SPEND/REFUND는 리셋 트리거 아님).
export async function recordPointTransaction(opts: {
  userId: number;
  type: PointTxType;
  amount: number;
  memo?: string;
  relatedTripId?: number;
  relatedReferralEntryId?: number;
  /** 레거시 회수 경로 호환 — true면 잔액이 음수가 되어도 허용 (기존 addPoints 동작). */
  allowNegative?: boolean;
}): Promise<{ id: number; balanceAfter: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const config = await getRewardConfigValues();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ pointsBalance: users.pointsBalance })
      .from(users)
      .where(eq(users.id, opts.userId))
      .for("update");
    if (!row) throw new Error(`User ${opts.userId} not found`);

    const newBalance = row.pointsBalance + opts.amount;
    if (newBalance < 0 && !opts.allowNegative) {
      throw new Error("포인트 잔액이 부족합니다.");
    }

    const isEarn = opts.type === "EARN_REFERRAL" || opts.type === "EARN_PROMO";
    await tx
      .update(users)
      .set({
        pointsBalance: newBalance,
        ...(isEarn && opts.amount > 0
          ? { pointsExpiresAt: new Date(Date.now() + config.ttlDays * 24 * 60 * 60 * 1000) }
          : {}),
      })
      .where(eq(users.id, opts.userId));

    const result = await tx.insert(pointTransactions).values({
      userId: opts.userId,
      type: opts.type,
      amount: opts.amount,
      balanceAfter: newBalance,
      relatedTripId: opts.relatedTripId,
      relatedReferralEntryId: opts.relatedReferralEntryId,
      memo: opts.memo,
    });
    return { id: (result[0] as any).insertId as number, balanceAfter: newBalance };
  });
}

// 레거시 타입 → 통합 원장 타입 매핑. 기존 호출부를 전부 새 원장으로 경유시킨다.
const LEGACY_POINT_TYPE_MAP: Record<Point["type"], PointTxType> = {
  referral_earn: "EARN_REFERRAL",
  booking_earn: "EARN_PROMO",
  admin_grant: "ADMIN_ADJUST",
  usage: "SPEND",
  refund: "REFUND",
  welcome: "EARN_PROMO",
};

// 기존 시그니처 유지 래퍼 — 신규 원장(point_transactions)으로 위임한다.
// allowNegative: 기존 addPoints는 음수 잔액을 허용했고(추천 적립 회수 등),
// 이를 유지해 취소/회수 플로우가 깨지지 않게 한다. 잔액 엄격 검증이 필요한
// 결제 차감은 recordPointTransaction을 직접(allowNegative 없이) 호출할 것.
export async function addPoints(
  userId: number,
  amount: number,
  type: Point["type"],
  description: string,
  refId?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await recordPointTransaction({
    userId,
    type: LEGACY_POINT_TYPE_MAP[type],
    amount,
    memo: refId ? `${description} (#${refId})` : description,
    allowNegative: true,
  });
}

export async function getPointTransactionsByUserId(userId: number): Promise<PointTransaction[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(pointTransactions)
    .where(eq(pointTransactions.userId, userId))
    .orderBy(desc(pointTransactions.createdAt));
}

// ─── Referral Entries (주문 단위 추천 건 — referral-credit-spec) ────────────────
export async function createReferralEntry(data: Omit<InsertReferralEntry, "id">): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(referralEntries).values(data);
  return (result[0] as any).insertId;
}

export async function getReferralEntryByReservationId(
  reservationId: number
): Promise<ReferralEntry | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(referralEntries)
    .where(eq(referralEntries.reservationId, reservationId))
    .limit(1);
  return rows[0];
}

// 동일 코드 최근 24시간 신규 입력 수 (spec §7-4 속도 제한).
export async function countRecentReferralEntriesByCode(code: string, since: Date): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(referralEntries)
    .where(and(eq(referralEntries.code, code), gte(referralEntries.createdAt, since)));
  return Number(row?.count ?? 0);
}

// 참가자 요율 판정 (spec §4.2): 추천인이 동일 event의 어떤 회차든 결제 완료
// 상태의 예약을 갖고 있는가. 판정은 추천 건 생성 시점 스냅샷으로만 쓰인다.
export async function hasPaidReservationForEvent(userId: number, eventId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: reservations.id })
    .from(reservations)
    .innerJoin(trips, eq(reservations.tripId, trips.id))
    .innerJoin(payments, eq(payments.reservationId, reservations.id))
    .where(and(eq(reservations.userId, userId), eq(trips.eventId, eventId), eq(payments.status, "paid")))
    .limit(1);
  return rows.length > 0;
}

// VOID 처리 (spec §4.4): 결제자 취소/트립 무산. PENDING·FLAGGED만 대상 —
// 이미 COMPLETED(지급됨)/REJECTED는 건드리지 않는다.
export async function voidReferralEntryByReservationId(reservationId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db
    .update(referralEntries)
    .set({ status: "VOID" })
    .where(
      and(
        eq(referralEntries.reservationId, reservationId),
        inArray(referralEntries.status, ["PENDING", "FLAGGED"])
      )
    );
  return ((result[0] as any)?.affectedRows ?? 0) > 0;
}

export async function voidReferralEntriesByTripId(tripId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .update(referralEntries)
    .set({ status: "VOID" })
    .where(and(eq(referralEntries.tripId, tripId), inArray(referralEntries.status, ["PENDING", "FLAGGED"])));
  return (result[0] as any)?.affectedRows ?? 0;
}

export async function getReferralEntriesByTripId(
  tripId: number,
  status?: ReferralEntry["status"]
): Promise<ReferralEntry[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(referralEntries)
    .where(
      status
        ? and(eq(referralEntries.tripId, tripId), eq(referralEntries.status, status))
        : eq(referralEntries.tripId, tripId)
    );
}

/**
 * 추천 건 1건 정산 (spec §4.3) — 단일 트랜잭션으로 exactly-once:
 * entry 행을 FOR UPDATE로 잠근 뒤 PENDING일 때만 지급한다. 적립액은
 * floor(실결제액 × 생성 시점 요율)에 상한을 적용. 유저 잔액 갱신 + 만료일
 * 리셋(EARN) + 원장 기록 + entry COMPLETED 전환이 전부 한 트랜잭션.
 */
export async function settleReferralEntry(
  entryId: number
): Promise<{ granted: boolean; amount?: number; referrerUserId?: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const config = await getRewardConfigValues();

  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(referralEntries)
      .where(eq(referralEntries.id, entryId))
      .for("update");
    if (!entry || entry.status !== "PENDING") return { granted: false };

    const amount = computeReferralReward(entry.paidAmount, Number(entry.appliedRate), config.capKrw);
    const now = new Date();

    let rewardTransactionId: number | null = null;
    if (amount > 0) {
      const [urow] = await tx
        .select({ pointsBalance: users.pointsBalance })
        .from(users)
        .where(eq(users.id, entry.referrerUserId))
        .for("update");
      if (!urow) return { granted: false };
      const newBalance = urow.pointsBalance + amount;
      await tx
        .update(users)
        .set({
          pointsBalance: newBalance,
          pointsExpiresAt: new Date(now.getTime() + config.ttlDays * 24 * 60 * 60 * 1000),
        })
        .where(eq(users.id, entry.referrerUserId));
      const insertResult = await tx.insert(pointTransactions).values({
        userId: entry.referrerUserId,
        type: "EARN_REFERRAL",
        amount,
        balanceAfter: newBalance,
        relatedTripId: entry.tripId,
        relatedReferralEntryId: entry.id,
        memo: `추천 적립 (예약 #${entry.reservationId}, ${entry.referrerIsParticipant ? "참가자" : "기본"} 요율)`,
      });
      rewardTransactionId = (insertResult[0] as any).insertId as number;
    }

    await tx
      .update(referralEntries)
      .set({ status: "COMPLETED", rewardAmount: amount, rewardTransactionId, completedAt: now })
      .where(eq(referralEntries.id, entryId));

    return { granted: true, amount, referrerUserId: entry.referrerUserId };
  });
}

// FLAGGED 건 관리자 결정 (spec §7-6): reject → REJECTED / approve → PENDING 복귀.
// (approve 후 트립이 이미 completed면 호출부에서 즉시 settleReferralEntry.)
export async function resolveFlaggedReferralEntry(
  entryId: number,
  action: "approve" | "reject"
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db
    .update(referralEntries)
    .set({ status: action === "approve" ? "PENDING" : "REJECTED" })
    .where(and(eq(referralEntries.id, entryId), eq(referralEntries.status, "FLAGGED")));
  return ((result[0] as any)?.affectedRows ?? 0) > 0;
}

export async function getFlaggedReferralEntries(): Promise<ReferralEntry[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(referralEntries)
    .where(eq(referralEntries.status, "FLAGGED"))
    .orderBy(desc(referralEntries.createdAt));
}

export interface ReferralStats {
  pending: number;
  completed: number;
  flagged: number;
  voided: number;
  totalEarned: number;
}
export async function getReferralStatsByReferrer(userId: number): Promise<ReferralStats> {
  const db = await getDb();
  const stats: ReferralStats = { pending: 0, completed: 0, flagged: 0, voided: 0, totalEarned: 0 };
  if (!db) return stats;
  const rows = await db
    .select({
      status: referralEntries.status,
      count: sql<number>`count(*)`,
      sum: sql<number>`coalesce(sum(${referralEntries.rewardAmount}), 0)`,
    })
    .from(referralEntries)
    .where(eq(referralEntries.referrerUserId, userId))
    .groupBy(referralEntries.status);
  for (const row of rows) {
    const n = Number(row.count);
    if (row.status === "PENDING") stats.pending = n;
    else if (row.status === "COMPLETED") {
      stats.completed = n;
      stats.totalEarned = Number(row.sum);
    } else if (row.status === "FLAGGED") stats.flagged = n;
    else if (row.status === "VOID") stats.voided = n;
  }
  return stats;
}

// 교차 입력 모니터링 (spec §7-5): 서로의 코드를 입력한 유저 쌍 집계.
export interface CrossUsagePair {
  userA: number;
  userB: number;
  aToB: number; // A가 추천인, B가 결제자인 건수
  bToA: number;
}
export async function getReferralCrossUsagePairs(): Promise<CrossUsagePair[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      referrerUserId: referralEntries.referrerUserId,
      payerUserId: referralEntries.payerUserId,
      count: sql<number>`count(*)`,
    })
    .from(referralEntries)
    .groupBy(referralEntries.referrerUserId, referralEntries.payerUserId);

  const byPair = new Map<string, number>();
  for (const row of rows) {
    byPair.set(`${row.referrerUserId}:${row.payerUserId}`, Number(row.count));
  }
  const result: CrossUsagePair[] = [];
  for (const row of rows) {
    const a = row.referrerUserId;
    const b = row.payerUserId;
    if (a >= b) continue; // 쌍당 1회만
    const aToB = byPair.get(`${a}:${b}`) ?? 0;
    const bToA = byPair.get(`${b}:${a}`) ?? 0;
    if (aToB > 0 && bToA > 0) result.push({ userA: a, userB: b, aToB, bToA });
  }
  return result;
}

// ─── 포인트 만료 배치 대상 조회 (spec §6) ───────────────────────────────────────
export async function getUsersWithExpiredPoints(now: Date): Promise<Pick<User, "id" | "pointsBalance" | "pointsExpiresAt">[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ id: users.id, pointsBalance: users.pointsBalance, pointsExpiresAt: users.pointsExpiresAt })
    .from(users)
    .where(and(isNotNull(users.pointsExpiresAt), lt(users.pointsExpiresAt, now), gt(users.pointsBalance, 0)));
}

export async function getUsersWithPointsExpiringBefore(limit: Date): Promise<Pick<User, "id" | "phone" | "pointsBalance" | "pointsExpiresAt">[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ id: users.id, phone: users.phone, pointsBalance: users.pointsBalance, pointsExpiresAt: users.pointsExpiresAt })
    .from(users)
    .where(and(isNotNull(users.pointsExpiresAt), lt(users.pointsExpiresAt, limit), gt(users.pointsBalance, 0)));
}

// ─── Referrals ────────────────────────────────────────────────────────────────
export async function getReferralsByUserId(userId: number): Promise<Referral[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(referrals)
    .where(eq(referrals.referrerId, userId))
    .orderBy(desc(referrals.createdAt));
}

export async function createReferral(data: InsertReferral): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(referrals).values(data);
  return (result[0] as any).insertId;
}

// Referral earn is a once-per-pair bonus: if this referrer/referee pair has
// ever triggered a referral (even a later-cancelled one), they don't get to
// re-earn it via a new reservation using the same code.
export async function getReferralByPair(
  referrerId: number,
  refereeId: number
): Promise<Referral | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(referrals)
    .where(and(eq(referrals.referrerId, referrerId), eq(referrals.refereeId, refereeId)))
    .limit(1);
  return rows[0];
}

export async function getReferralByReservationId(reservationId: number): Promise<Referral | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(referrals)
    .where(eq(referrals.reservationId, reservationId))
    .limit(1);
  return rows[0];
}

export async function updateReferralStatus(id: number, status: Referral["status"]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(referrals).set({ status }).where(eq(referrals.id, id));
}

export async function getUserByReferralCode(code: string): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.referralCode, code)).limit(1);
  return result[0];
}

// ─── Stop Candidates ──────────────────────────────────────────────────────────
export async function getActiveStopCandidates(): Promise<StopCandidate[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(stopCandidates).where(eq(stopCandidates.active, true));
}

export async function getAllStopCandidates(): Promise<StopCandidate[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(stopCandidates).orderBy(desc(stopCandidates.createdAt));
}

export async function createStopCandidate(data: InsertStopCandidate): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(stopCandidates).values(data);
  return (result[0] as any).insertId;
}

export async function updateStopCandidate(
  id: number,
  data: Partial<InsertStopCandidate>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(stopCandidates).set(data).where(eq(stopCandidates.id, id));
}

export async function setStopCandidateActive(id: number, active: boolean): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(stopCandidates).set({ active }).where(eq(stopCandidates.id, id));
}

// ─── Rally Point Candidates ─────────────────────────────────────────────────────
// Community-sourced pickup spot suggestions. Distinct from stopCandidates: every
// active one (verified or not) is shown on the map, but only busAccessible ones
// are offered to the matching pipeline as cluster-snap targets.
export async function getActiveRallyPointCandidates(): Promise<RallyPointCandidate[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rallyPointCandidates).where(eq(rallyPointCandidates.isActive, true));
}

export async function getBusAccessibleRallyPointCandidates(): Promise<RallyPointCandidate[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(rallyPointCandidates)
    .where(and(eq(rallyPointCandidates.isActive, true), eq(rallyPointCandidates.busAccessible, true)));
}

// ─── Clusters ─────────────────────────────────────────────────────────────────
export async function getClustersByEventId(eventId: number): Promise<Cluster[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(clusters).where(eq(clusters.eventId, eventId));
}

export async function createCluster(data: InsertCluster): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(clusters).values(data);
  return (result[0] as any).insertId;
}

export async function updateCluster(id: number, data: Partial<InsertCluster>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(clusters).set(data).where(eq(clusters.id, id));
}

export async function deleteClustersByEventId(eventId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(clusters).where(eq(clusters.eventId, eventId));
}

// ─── Matching commit (transactional) ──────────────────────────────────────────
export interface PersistMatchingInput {
  eventId: number;
  creatorId: number;
  minCount: number;
  maxCount: number;
  finalPricePerSeat: number;
  output: PipelineOutput;
  stopNameById: Map<number, string>;
  requestById: Map<number, RideRequest>;
  // Only paid Toss payments, keyed by rideRequestId — used to link the
  // payment to the new reservation (inside the tx) and to schedule the
  // cap-vs-final difference refund (outside the tx, by the caller).
  tossPaymentByRequestId: Map<number, Payment>;
}

export interface PersistMatchingResult {
  createdTripIds: number[];
  createdTripCount: number;
  matchedRequestCount: number;
  differenceRefunds: { payment: Payment; userId: number; requestId: number; seats: number }[];
  notifications: { tripId: number; userId: number; passengerName: string; seats: number; departureAt: Date }[];
}

export interface PersistMatchingHooks {
  // Test-only seam: invoked once after the first trip (and its members) are
  // fully persisted, to force a mid-transaction failure and prove rollback.
  failAfterFirstTrip?: () => void | Promise<void>;
}

/**
 * Persists an entire matching pipeline result for one event in a SINGLE DB
 * transaction: clears any prior (still-collecting) pipeline output, inserts
 * clusters + trips + boarding points + reservations, links/creates payments,
 * and finalizes each matched ride request. Any mid-way failure rolls the
 * whole thing back, so the event is never left half-matched.
 *
 * External side effects (Toss difference refunds, notifications, D-5 instant
 * confirm) are deliberately NOT done here — they run after commit, driven by
 * the returned differenceRefunds/notifications. The freeze mark is set by the
 * caller BEFORE calling this, outside the transaction.
 */
export async function persistMatchingCommit(
  input: PersistMatchingInput,
  hooks: PersistMatchingHooks = {}
): Promise<PersistMatchingResult> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const {
    eventId,
    creatorId,
    minCount,
    maxCount,
    finalPricePerSeat,
    output,
    stopNameById,
    requestById,
    tossPaymentByRequestId,
  } = input;

  return db.transaction(async (tx) => {
    // ── Cleanup prior pipeline output (idempotent recompute) ──
    const priorTrips = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.eventId, eventId), isNotNull(trips.sourceClusterId), eq(trips.status, "collecting")));

    for (const trip of priorTrips) {
      // Pull matched requests back into the pending pool.
      await tx
        .update(rideRequests)
        .set({ clusterId: null, tripId: null, boardingPointId: null, reservationId: null, status: "pending" })
        .where(eq(rideRequests.tripId, trip.id));

      const priorReservations = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(eq(reservations.tripId, trip.id));
      const priorReservationIds = priorReservations.map((r) => r.id);

      if (priorReservationIds.length > 0) {
        const priorPayments = await tx
          .select({ id: payments.id, method: payments.method })
          .from(payments)
          .where(inArray(payments.reservationId, priorReservationIds));
        // Real (toss) payment rows are money-of-record: unlink from the
        // reservation instead of deleting; mock rows are deletable.
        const tossPaymentIds = priorPayments.filter((p) => p.method === "toss").map((p) => p.id);
        const mockPaymentIds = priorPayments.filter((p) => p.method !== "toss").map((p) => p.id);
        if (tossPaymentIds.length > 0) {
          await tx.update(payments).set({ reservationId: null }).where(inArray(payments.id, tossPaymentIds));
        }
        if (mockPaymentIds.length > 0) {
          await tx.delete(paymentItems).where(inArray(paymentItems.paymentId, mockPaymentIds));
          await tx.delete(payments).where(inArray(payments.id, mockPaymentIds));
        }
        await tx.delete(reservations).where(inArray(reservations.id, priorReservationIds));
      }

      await tx.delete(boardingPoints).where(eq(boardingPoints.tripId, trip.id));
      await tx.delete(trips).where(eq(trips.id, trip.id));
    }

    // Reset still-clustered requests and drop prior clusters.
    await tx
      .update(rideRequests)
      .set({ clusterId: null, status: "pending" })
      .where(and(eq(rideRequests.eventId, eventId), eq(rideRequests.status, "clustered")));
    await tx.delete(clusters).where(eq(clusters.eventId, eventId));

    // ── Persist clusters + assignments ──
    const dbClusterIdByPipelineClusterId = new Map<number, number>();
    const clusterResultByPipelineClusterId = new Map(output.clusters.map((c) => [c.clusterId, c]));

    for (const cluster of output.clusters) {
      const inserted = await tx.insert(clusters).values({
        eventId,
        groupKey: cluster.groupKey,
        status: cluster.status,
        assignedStopId: cluster.assignedStopId,
        assignedLat: String(cluster.assignedLat),
        assignedLng: String(cluster.assignedLng),
        isAdHocStop: cluster.isAdHocStop,
        size: cluster.memberRequestIds.length,
      });
      const dbClusterId = (inserted[0] as any).insertId;
      dbClusterIdByPipelineClusterId.set(cluster.clusterId, dbClusterId);
      if (cluster.status !== "failed" && cluster.memberRequestIds.length > 0) {
        await tx
          .update(rideRequests)
          .set({ clusterId: dbClusterId, status: "clustered" })
          .where(inArray(rideRequests.id, cluster.memberRequestIds));
      }
    }

    // ── Persist trips + boarding points + reservations ──
    const result: PersistMatchingResult = {
      createdTripIds: [],
      createdTripCount: 0,
      matchedRequestCount: 0,
      differenceRefunds: [],
      notifications: [],
    };

    for (let routeIdx = 0; routeIdx < output.routes.length; routeIdx++) {
      const route = output.routes[routeIdx];
      const firstStop = route.stops[0];
      const sourceClusterId = firstStop
        ? dbClusterIdByPipelineClusterId.get(firstStop.clusterId) ?? null
        : null;

      const insertedTrip = await tx.insert(trips).values({
        eventId,
        mode: "bus",
        status: "collecting",
        minCount,
        maxCount,
        price: finalPricePerSeat,
        departureAt: route.departureAt,
        isRoundTrip: false,
        creatorId,
        sourceClusterId,
      });
      const tripId = (insertedTrip[0] as any).insertId;
      result.createdTripIds.push(tripId);
      let tripSeatCount = 0;

      for (const stop of route.stops) {
        const clusterResult = clusterResultByPipelineClusterId.get(stop.clusterId);
        const dbClusterId = dbClusterIdByPipelineClusterId.get(stop.clusterId) ?? null;
        const stopName = clusterResult?.assignedStopId
          ? stopNameById.get(clusterResult.assignedStopId) ?? "정류장"
          : "임시 정류장";

        const insertedBp = await tx.insert(boardingPoints).values({
          tripId,
          name: stopName,
          lat: String(stop.lat),
          lng: String(stop.lng),
          pickupTime: stop.pickupTime,
          order: stop.order,
        });
        const boardingPointId = (insertedBp[0] as any).insertId;

        if (dbClusterId !== null) {
          await tx.update(clusters).set({ tripId }).where(eq(clusters.id, dbClusterId));
        }

        for (const requestId of clusterResult?.memberRequestIds ?? []) {
          const request = requestById.get(requestId);
          if (!request) continue;

          const insertedReservation = await tx.insert(reservations).values({
            userId: request.userId,
            tripId,
            boardingPointId,
            seats: request.seats,
            pointsUsed: 0,
            passengerName: request.passengerName ?? undefined,
            passengerPhone: request.passengerPhone ?? undefined,
            passengerEmail: request.passengerEmail ?? undefined,
            referralCode: request.referralCodeUsed ?? undefined,
            qrToken: nanoid(32),
          });
          const reservationId = (insertedReservation[0] as any).insertId;

          const tossPayment = tossPaymentByRequestId.get(request.id);
          if (tossPayment) {
            // Link the pre-paid Toss order to this reservation; the cap-vs-final
            // difference refund runs after commit (external Toss API call).
            await tx.update(payments).set({ reservationId }).where(eq(payments.id, tossPayment.id));
            result.differenceRefunds.push({
              payment: tossPayment,
              userId: request.userId,
              requestId: request.id,
              seats: request.seats,
            });
          } else {
            const insertedPayment = await tx.insert(payments).values({
              reservationId,
              totalAmount: Math.max(0, finalPricePerSeat * request.seats - request.pointsUsed),
              status: "paid",
              method: "mock",
              chargeType: "prepaid",
              paidAt: new Date(),
            });
            const paymentId = (insertedPayment[0] as any).insertId;
            await tx.insert(paymentItems).values({
              paymentId,
              type: "fare",
              amount: Math.max(0, finalPricePerSeat * request.seats - request.pointsUsed),
              label: "셔틀 요금",
            });
          }

          await tx
            .update(rideRequests)
            .set({ status: "route_confirmed", tripId, boardingPointId, reservationId })
            .where(eq(rideRequests.id, request.id));

          tripSeatCount += request.seats;
          result.matchedRequestCount++;
          result.notifications.push({
            tripId,
            userId: request.userId,
            passengerName: request.passengerName ?? "고객",
            seats: request.seats,
            departureAt: route.departureAt,
          });
        }
      }

      await tx.update(trips).set({ currentCount: tripSeatCount }).where(eq(trips.id, tripId));
      result.createdTripCount++;

      if (routeIdx === 0 && hooks.failAfterFirstTrip) {
        await hooks.failAfterFirstTrip();
      }
    }

    return result;
  });
}

// ─── Ride Requests ────────────────────────────────────────────────────────────
export async function getRideRequestsByEventId(eventId: number): Promise<RideRequest[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(rideRequests)
    .where(eq(rideRequests.eventId, eventId))
    .orderBy(desc(rideRequests.createdAt));
}

export async function getPendingRideRequestsByEventId(eventId: number): Promise<RideRequest[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(rideRequests)
    .where(and(eq(rideRequests.eventId, eventId), eq(rideRequests.status, "pending")));
}

// Minimal projection for the anonymized demand map: only origin coordinates
// and seat count ever leave the DB layer here — no id, name, phone, or
// address, so there's nothing sensitive for a caller to accidentally forward.
export interface RideRequestOrigin {
  originLat: string;
  originLng: string;
  seats: number;
}

export async function getRideRequestOriginsByEventId(
  eventId: number,
  statuses: RideRequest["status"][]
): Promise<RideRequestOrigin[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      originLat: rideRequests.originLat,
      originLng: rideRequests.originLng,
      seats: rideRequests.seats,
    })
    .from(rideRequests)
    .where(and(eq(rideRequests.eventId, eventId), inArray(rideRequests.status, statuses)));
}

export async function getRideRequestById(id: number): Promise<RideRequest | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(rideRequests).where(eq(rideRequests.id, id)).limit(1);
  return result[0];
}

export async function getRideRequestsByUserId(userId: number): Promise<RideRequest[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(rideRequests)
    .where(eq(rideRequests.userId, userId))
    .orderBy(desc(rideRequests.createdAt));
}

export async function createRideRequest(data: InsertRideRequest): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(rideRequests).values(data);
  return (result[0] as any).insertId;
}

export async function updateRideRequestStatus(
  id: number,
  status: RideRequest["status"],
  extra?: Partial<RideRequest>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(rideRequests).set({ status, ...extra }).where(eq(rideRequests.id, id));
}

export async function assignRideRequestsToCluster(
  requestIds: number[],
  clusterId: number
): Promise<void> {
  const db = await getDb();
  if (!db || requestIds.length === 0) return;
  await db
    .update(rideRequests)
    .set({ clusterId, status: "clustered" })
    .where(inArray(rideRequests.id, requestIds));
}

export async function clearRideRequestClusterAssignments(eventId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(rideRequests)
    .set({ clusterId: null, status: "pending" })
    .where(and(eq(rideRequests.eventId, eventId), eq(rideRequests.status, "clustered")));
}

// Resets any ride requests still pointing at a trip that's about to be deleted
// (e.g. a "collecting" pipeline trip being rebuilt on recompute) back into the
// pending pool. Needed because finalizeRideRequestRoute advances requests all
// the way to "route_confirmed" within a single commit, so by the time a later
// commit re-runs, they're never still in the "clustered" state that
// clearRideRequestClusterAssignments alone resets.
export async function clearRideRequestsByTripId(tripId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(rideRequests)
    .set({ clusterId: null, tripId: null, boardingPointId: null, reservationId: null, status: "pending" })
    .where(eq(rideRequests.tripId, tripId));
}

export async function finalizeRideRequestRoute(
  id: number,
  data: { tripId: number; boardingPointId: number; reservationId: number }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(rideRequests)
    .set({ status: "route_confirmed", ...data })
    .where(eq(rideRequests.id, id));
}

// ─── Consents ─────────────────────────────────────────────────────────────────
export async function insertConsent(data: InsertConsent): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(consents).values(data);
}

export async function getLatestConsentByUserAndType(
  userId: number,
  type: string
): Promise<Consent | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.type, type)))
    .orderBy(desc(consents.id))
    .limit(1);
  return rows[0];
}

// ─── Bungaeting: profiles & preferences ────────────────────────────────────────
export async function getBungaetingProfileByUserId(
  userId: number
): Promise<BungaetingProfile | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(bungaetingProfiles)
    .where(eq(bungaetingProfiles.userId, userId))
    .limit(1);
  return rows[0];
}

export async function getBungaetingProfilesByUserIds(
  userIds: number[]
): Promise<BungaetingProfile[]> {
  const db = await getDb();
  if (!db || userIds.length === 0) return [];
  return db
    .select()
    .from(bungaetingProfiles)
    .where(inArray(bungaetingProfiles.userId, userIds));
}

export async function createBungaetingProfile(
  data: InsertBungaetingProfile
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(bungaetingProfiles).values(data);
  return (result[0] as any).insertId;
}

export async function updateBungaetingProfile(
  userId: number,
  data: Partial<InsertBungaetingProfile>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(bungaetingProfiles).set(data).where(eq(bungaetingProfiles.userId, userId));
}

export async function getBungaetingPreferenceByUserId(
  userId: number
): Promise<BungaetingPreference | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(bungaetingPreferences)
    .where(eq(bungaetingPreferences.userId, userId))
    .limit(1);
  return rows[0];
}

// 선호 등록은 유저당 1건 — 있으면 갱신, 없으면 삽입. userId UNIQUE 인덱스로
// onDuplicateKeyUpdate가 원자적으로 한 행만 유지한다.
export async function upsertBungaetingPreference(
  userId: number,
  data: Omit<InsertBungaetingPreference, "id" | "userId">
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(bungaetingPreferences)
    .values({ ...data, userId })
    .onDuplicateKeyUpdate({ set: { ...data } });
}

// ─── Bungaeting: 회차 제안 + 찜 (spec §3-5) ────────────────────────────────────
export async function createBungaetingProposal(
  data: Omit<InsertBungaetingTripProposal, "id">
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(bungaetingTripProposals).values(data);
  return (result[0] as any).insertId;
}

export async function getBungaetingProposalById(id: number): Promise<BungaetingTripProposal | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(bungaetingTripProposals).where(eq(bungaetingTripProposals.id, id)).limit(1);
  return rows[0];
}

export async function getOpenBungaetingProposals(): Promise<BungaetingTripProposal[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(bungaetingTripProposals)
    .where(eq(bungaetingTripProposals.status, "open"))
    .orderBy(desc(bungaetingTripProposals.createdAt));
}

// 찜 멱등 토글 — event_likes/point_interests와 동일 패턴(ER_DUP_ENTRY 안전).
// 이미 찜한 상태에서 다시 부르면 해제, 없으면 등록. genderModePreference는 등록 시 저장.
export async function toggleBungaetingProposalInterest(
  proposalId: number,
  userId: number,
  genderModePreference: BungaetingProposalInterest["genderModePreference"]
): Promise<{ interested: boolean; count: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const existing = await db
    .select({ id: bungaetingProposalInterests.id })
    .from(bungaetingProposalInterests)
    .where(
      and(
        eq(bungaetingProposalInterests.proposalId, proposalId),
        eq(bungaetingProposalInterests.userId, userId)
      )
    )
    .limit(1);

  let interested: boolean;
  if (existing.length > 0) {
    await db.delete(bungaetingProposalInterests).where(eq(bungaetingProposalInterests.id, existing[0].id));
    interested = false;
  } else {
    try {
      await db.insert(bungaetingProposalInterests).values({ proposalId, userId, genderModePreference });
      interested = true;
    } catch (error) {
      if (isDuplicateKeyError(error)) interested = true;
      else throw error;
    }
  }

  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(bungaetingProposalInterests)
    .where(eq(bungaetingProposalInterests.proposalId, proposalId));
  return { interested, count: Number(row?.count ?? 0) };
}

// 성비 모드별 찜 집계 (genderModePreference로 구분). null(모드 미선택)은 "any" 버킷에 합산.
export async function getBungaetingProposalInterestBreakdown(
  proposalId: number
): Promise<{ total: number; byMode: Record<string, number> }> {
  const db = await getDb();
  if (!db) return { total: 0, byMode: {} };
  const rows = await db
    .select({ mode: bungaetingProposalInterests.genderModePreference, count: sql<number>`count(*)` })
    .from(bungaetingProposalInterests)
    .where(eq(bungaetingProposalInterests.proposalId, proposalId))
    .groupBy(bungaetingProposalInterests.genderModePreference);
  const byMode: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const key = r.mode ?? "any";
    byMode[key] = (byMode[key] ?? 0) + Number(r.count);
    total += Number(r.count);
  }
  return { total, byMode };
}

export async function getInterestedProposalIds(userId: number): Promise<Set<number>> {
  const set = new Set<number>();
  const db = await getDb();
  if (!db) return set;
  const rows = await db
    .select({ proposalId: bungaetingProposalInterests.proposalId })
    .from(bungaetingProposalInterests)
    .where(eq(bungaetingProposalInterests.userId, userId));
  for (const r of rows) set.add(r.proposalId);
  return set;
}

// 전환 시 우선 결제 알림 대상 — 찜한 사용자들의 전화번호.
export async function getBungaetingProposalInterestedUsers(
  proposalId: number
): Promise<{ userId: number; phone: string | null }[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ userId: bungaetingProposalInterests.userId, phone: users.phone })
    .from(bungaetingProposalInterests)
    .innerJoin(users, eq(bungaetingProposalInterests.userId, users.id))
    .where(eq(bungaetingProposalInterests.proposalId, proposalId));
}

// 전환: open일 때만 converted로 플립(멱등 — 이미 전환됐으면 false).
export async function convertBungaetingProposalIfOpen(
  proposalId: number,
  convertedTripId: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db
    .update(bungaetingTripProposals)
    .set({ status: "converted", convertedTripId })
    .where(and(eq(bungaetingTripProposals.id, proposalId), eq(bungaetingTripProposals.status, "open")));
  return ((result[0] as any).affectedRows ?? 0) > 0;
}

// 제안자 보상 지급 잠금 — rewardGrantedAt이 NULL일 때만 세팅(조건부 UPDATE).
// affectedRows>0을 받은 호출자만 실제 addPoints를 수행 → 재전환/재실행 이중 지급 방지.
export async function claimBungaetingProposalReward(proposalId: number, now: Date = new Date()): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db
    .update(bungaetingTripProposals)
    .set({ rewardGrantedAt: now })
    .where(and(eq(bungaetingTripProposals.id, proposalId), isNull(bungaetingTripProposals.rewardGrantedAt)));
  return ((result[0] as any).affectedRows ?? 0) > 0;
}

// ─── Bungaeting: admin — 신고 처리 / 이용제한 / 모집현황 / 알림 (spec §7) ────────

// 이용제한(restrict) 시 정리 대상: 그 유저의 "미확정(collecting)" 번개팅 회차 예약.
// 이미 확정된 회차는 다른 참가자 피해 방지를 위해 유지한다 (spec §7-2).
export async function getUnconfirmedBungaetingReservationIdsByUser(userId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ id: reservations.id })
    .from(reservations)
    .innerJoin(trips, eq(reservations.tripId, trips.id))
    .where(
      and(
        eq(reservations.userId, userId),
        eq(trips.theme, "bungaeting"),
        eq(trips.status, "collecting")
      )
    );
  return rows.map((r) => r.id);
}

export async function insertBungaetingReport(data: Omit<InsertBungaetingReport, "id">): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(bungaetingReports).values(data);
  return (result[0] as any).insertId;
}

export async function getBungaetingReportById(id: number): Promise<BungaetingReport | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(bungaetingReports).where(eq(bungaetingReports.id, id)).limit(1);
  return rows[0];
}

// 관리자 신고함: 미처리(pending) 신고 + 대상/신고자 닉네임.
export interface BungaetingReportRow {
  id: number;
  reporterId: number;
  targetUserId: number;
  tripId: number;
  reason: string | null;
  status: BungaetingReport["status"];
  createdAt: Date;
  targetNickname: string | null;
  targetStatus: string | null;
}
export async function getPendingBungaetingReports(): Promise<BungaetingReportRow[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: bungaetingReports.id,
      reporterId: bungaetingReports.reporterId,
      targetUserId: bungaetingReports.targetUserId,
      tripId: bungaetingReports.tripId,
      reason: bungaetingReports.reason,
      status: bungaetingReports.status,
      createdAt: bungaetingReports.createdAt,
      targetNickname: bungaetingProfiles.nickname,
      targetStatus: bungaetingProfiles.status,
    })
    .from(bungaetingReports)
    .leftJoin(bungaetingProfiles, eq(bungaetingReports.targetUserId, bungaetingProfiles.userId))
    .where(eq(bungaetingReports.status, "pending"))
    .orderBy(desc(bungaetingReports.createdAt));
  return rows as BungaetingReportRow[];
}

export async function resolveBungaetingReport(
  id: number,
  status: BungaetingReport["status"],
  handledBy: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(bungaetingReports)
    .set({ status, handledBy, handledAt: new Date() })
    .where(eq(bungaetingReports.id, id));
}

// 알림 발송 대상 전화번호 — 특정 회차 참가자(비취소).
export async function getBungaetingTripParticipantPhones(tripId: number): Promise<{ userId: number; phone: string | null }[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ userId: reservations.userId, phone: users.phone })
    .from(reservations)
    .innerJoin(users, eq(reservations.userId, users.id))
    .where(eq(reservations.tripId, tripId));
  return rows;
}

// 알림 발송 대상 전화번호 — SMS 수신 동의한 선호등록자 전원(성별 무관, §4-5).
export async function getBungaetingSmsOptInPhones(): Promise<{ userId: number; phone: string | null }[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ userId: bungaetingPreferences.userId, phone: users.phone })
    .from(bungaetingPreferences)
    .innerJoin(users, eq(bungaetingPreferences.userId, users.id))
    .where(eq(bungaetingPreferences.smsOptIn, true));
}

// 관리자 콘솔: 모든 번개팅 트립(모집현황·편집 대상).
export async function getAllBungaetingTrips(): Promise<Trip[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(trips)
    .where(eq(trips.theme, "bungaeting"))
    .orderBy(desc(trips.createdAt));
}

// ─── Event Requests (이벤트 만들기 신청) ────────────────────────────────────────
export async function createEventRequest(data: Omit<InsertEventRequest, "id">): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(eventRequests).values(data);
  return (result[0] as any).insertId;
}

export async function getEventRequests(): Promise<EventRequest[]> {
  const db = await getDb();
  if (!db) return [];
  // pending 먼저, 최신순.
  return db.select().from(eventRequests).orderBy(eventRequests.status, desc(eventRequests.createdAt));
}

// 내 이벤트 만들기 신청 내역 (마이페이지 '참가 신청' 탭).
export async function getEventRequestsByUserId(userId: number): Promise<EventRequest[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(eventRequests).where(eq(eventRequests.userId, userId)).orderBy(desc(eventRequests.createdAt));
}

export async function setEventRequestStatus(id: number, status: EventRequest["status"]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(eventRequests).set({ status }).where(eq(eventRequests.id, id));
}

// ─── Shuttle Demands (셔틀 만들기 — 희망 탑승지 수요) ───────────────────────────
// 유저당 이벤트당 1건 — 재신청 시 선택을 교체(upsert). UNIQUE(eventId,userId).
export async function upsertShuttleDemand(
  eventId: number,
  userId: number,
  data: Pick<InsertShuttleDemand, "area" | "stopLabel" | "neighborhood">
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .insert(shuttleDemands)
    .values({ eventId, userId, ...data })
    .onDuplicateKeyUpdate({
      set: { area: data.area, stopLabel: data.stopLabel, neighborhood: data.neighborhood ?? null },
    });
}

export async function getShuttleDemandStatus(
  eventId: number,
  userId?: number
): Promise<{ count: number; mine: ShuttleDemand | null }> {
  const db = await getDb();
  if (!db) return { count: 0, mine: null };
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(shuttleDemands)
    .where(eq(shuttleDemands.eventId, eventId));
  let mine: ShuttleDemand | null = null;
  if (userId) {
    const rows = await db
      .select()
      .from(shuttleDemands)
      .where(and(eq(shuttleDemands.eventId, eventId), eq(shuttleDemands.userId, userId)))
      .limit(1);
    mine = rows[0] ?? null;
  }
  return { count: Number(row?.count ?? 0), mine };
}

// 내 셔틀 만들기(희망 탑승지) 신청 내역 — 이벤트 제목 포함 (마이페이지 '참가 신청' 탭).
export interface MyShuttleDemandRow {
  id: number;
  eventId: number;
  eventTitle: string;
  area: "capital" | "other";
  stopLabel: string;
  neighborhood: string | null;
  createdAt: Date;
}
export async function getShuttleDemandsByUserId(userId: number): Promise<MyShuttleDemandRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: shuttleDemands.id,
      eventId: shuttleDemands.eventId,
      eventTitle: events.title,
      area: shuttleDemands.area,
      stopLabel: shuttleDemands.stopLabel,
      neighborhood: shuttleDemands.neighborhood,
      createdAt: shuttleDemands.createdAt,
    })
    .from(shuttleDemands)
    .innerJoin(events, eq(shuttleDemands.eventId, events.id))
    .where(eq(shuttleDemands.userId, userId))
    .orderBy(desc(shuttleDemands.createdAt));
}

// 관리자 집계: 이벤트별 수요 수 + 상위 탑승지.
export interface ShuttleDemandSummaryRow {
  eventId: number;
  eventTitle: string;
  count: number;
  topStops: string[];
}
export async function getShuttleDemandSummary(): Promise<ShuttleDemandSummaryRow[]> {
  const db = await getDb();
  if (!db) return [];
  const counts = await db
    .select({ eventId: shuttleDemands.eventId, title: events.title, count: sql<number>`count(*)` })
    .from(shuttleDemands)
    .innerJoin(events, eq(shuttleDemands.eventId, events.id))
    .groupBy(shuttleDemands.eventId, events.title)
    .orderBy(desc(sql`count(*)`));
  const result: ShuttleDemandSummaryRow[] = [];
  for (const c of counts) {
    const stops = await db
      .select({ stopLabel: shuttleDemands.stopLabel, n: sql<number>`count(*)` })
      .from(shuttleDemands)
      .where(eq(shuttleDemands.eventId, c.eventId))
      .groupBy(shuttleDemands.stopLabel)
      .orderBy(desc(sql`count(*)`))
      .limit(5);
    result.push({
      eventId: c.eventId,
      eventTitle: c.title,
      count: Number(c.count),
      topStops: stops.map((s) => `${s.stopLabel}(${Number(s.n)})`),
    });
  }
  return result;
}
