import { and, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  BoardingPoint,
  Event,
  InsertBoardingPoint,
  InsertEvent,
  InsertPoint,
  InsertReferral,
  InsertReservation,
  InsertTrip,
  InsertUser,
  Point,
  Referral,
  Reservation,
  Trip,
  User,
  boardingPoints,
  events,
  points,
  referrals,
  reservations,
  trips,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { nanoid } from "nanoid";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
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

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserById(id: number): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
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
