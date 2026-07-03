import { and, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool, type PoolOptions } from "mysql2/promise";
import {
  BoardingPoint,
  Cluster,
  Event,
  InsertBoardingPoint,
  InsertCluster,
  InsertEvent,
  InsertPoint,
  InsertReferral,
  InsertReservation,
  InsertRideRequest,
  InsertStopCandidate,
  InsertTrip,
  InsertUser,
  Point,
  Referral,
  Reservation,
  RideRequest,
  StopCandidate,
  Trip,
  User,
  boardingPoints,
  clusters,
  events,
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

let _db: ReturnType<typeof drizzle> | null = null;

export function isRecoverableDatabaseError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
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
}

export function buildMysqlPoolConfig(databaseUrl: string): PoolOptions {
  const parsed = new URL(databaseUrl);
  const sslParam = parsed.searchParams.get("ssl");

  let ssl: PoolOptions["ssl"] | undefined;
  if (sslParam === "true" || sslParam === "1") {
    ssl = { rejectUnauthorized: false };
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
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

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
  }
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
  status: Trip["status"]
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(trips).set({ status }).where(eq(trips.id, id));
}

export async function incrementTripCount(tripId: number, seats: number): Promise<Trip | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  await db
    .update(trips)
    .set({ currentCount: sql`${trips.currentCount} + ${seats}` })
    .where(eq(trips.id, tripId));
  // Auto-confirm if min reached
  const trip = await getTripById(tripId);
  if (trip && trip.currentCount >= trip.minCount && trip.status === "collecting") {
    await updateTripStatus(tripId, "confirmed");
    return { ...trip, status: "confirmed" };
  }
  return trip;
}

export async function decrementTripCount(tripId: number, seats: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(trips)
    .set({ currentCount: sql`GREATEST(0, ${trips.currentCount} - ${seats})` })
    .where(eq(trips.id, tripId));
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
export async function getReservationsByUserId(userId: number): Promise<Reservation[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(reservations)
    .where(eq(reservations.userId, userId))
    .orderBy(desc(reservations.createdAt));
}

export async function getReservationById(id: number): Promise<Reservation | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
  return result[0];
}

export async function createReservation(data: InsertReservation): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const qrToken = nanoid(32);
  const result = await db.insert(reservations).values({ ...data, qrToken });
  return (result[0] as any).insertId;
}

export async function updateReservationStatus(
  id: number,
  status: Reservation["status"],
  extra?: Partial<Reservation>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(reservations).set({ status, ...extra }).where(eq(reservations.id, id));
}

export async function getAllReservations(): Promise<Reservation[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reservations).orderBy(desc(reservations.createdAt));
}

export async function deleteReservationsByTripId(tripId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(reservations).where(eq(reservations.tripId, tripId));
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
  const user = await getUserById(userId);
  const currentBalance = user?.pointsBalance ?? 0;
  const newBalance = currentBalance + amount;
  await db.update(users).set({ pointsBalance: newBalance }).where(eq(users.id, userId));
  await db.insert(points).values({
    userId,
    type,
    amount,
    balanceAfter: newBalance,
    description,
    refId,
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
