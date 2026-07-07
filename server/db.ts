import { and, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool, type PoolOptions } from "mysql2/promise";
import {
  BoardingPoint,
  ChargeType,
  Cluster,
  Consent,
  Event,
  InsertBoardingPoint,
  InsertCluster,
  InsertConsent,
  InsertEvent,
  InsertPoint,
  InsertReferral,
  InsertReservation,
  InsertRideRequest,
  InsertStopCandidate,
  InsertTrip,
  InsertUser,
  Payment,
  PaymentCancelReason,
  PaymentItem,
  PaymentItemType,
  PaymentMethod,
  Point,
  Referral,
  Reservation,
  RideRequest,
  StopCandidate,
  Trip,
  TripCancelReason,
  User,
  UserStatus,
  boardingPoints,
  clusters,
  consents,
  events,
  paymentItems,
  payments,
  points,
  referrals,
  reservations,
  rideRequests,
  stopCandidates,
  trips,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { nanoid } from "nanoid";

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

  const textFields = ["name", "email", "loginMethod"] as const;
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
    conditions.push(
      or(
        like(events.title, `%${opts.search}%`),
        like(events.venue, `%${opts.search}%`)
      )!
    );
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
  return (result[0] as any).affectedRows > 0;
}

export async function getTripsByStatus(status: Trip["status"]): Promise<Trip[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(trips).where(eq(trips.status, status));
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
  reservationId: number;
  method: PaymentMethod;
  chargeType: ChargeType;
  items: { type: PaymentItemType; amount: number; label: string }[];
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const totalAmount = data.items.reduce((sum, item) => sum + item.amount, 0);
  const result = await db.insert(payments).values({
    reservationId: data.reservationId,
    totalAmount,
    status: "paid",
    method: data.method,
    chargeType: data.chargeType,
    paidAt: new Date(),
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
    .select({ id: payments.id })
    .from(payments)
    .where(inArray(payments.reservationId, reservationIds));
  const paymentIds = paymentRows.map((p) => p.id);
  if (paymentIds.length > 0) {
    await db.delete(paymentItems).where(inArray(paymentItems.paymentId, paymentIds));
  }
  await db.delete(payments).where(inArray(payments.reservationId, reservationIds));
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

export async function addPoints(
  userId: number,
  amount: number,
  type: Point["type"],
  description: string,
  refId?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Atomic SET pointsBalance = pointsBalance + ? instead of read-then-write,
  // so concurrent addPoints calls for the same user can't lose an update.
  // Wrapped in a transaction so the balanceAfter read-back sees this exact
  // write (the UPDATE's row lock blocks any other addPoints on this user
  // until we commit) and the ledger row is written atomically with it.
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ pointsBalance: sql`${users.pointsBalance} + ${amount}` })
      .where(eq(users.id, userId));

    const [row] = await tx
      .select({ pointsBalance: users.pointsBalance })
      .from(users)
      .where(eq(users.id, userId));
    const newBalance = row?.pointsBalance ?? amount;

    await tx.insert(points).values({
      userId,
      type,
      amount,
      balanceAfter: newBalance,
      description,
      refId,
    });
  });
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
