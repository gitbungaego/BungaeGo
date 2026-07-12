import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { cascadeDeleteEventWithRefunds, getDb } from "./db";
import { boardingPoints, events, paymentItems, payments, points, reservations, trips, users } from "../drizzle/schema";

// Real-DB integration test for the transactional cascade delete: full refunds
// (no fee), soft-deletes, points restore, deduped recipients, and rollback on
// mid-transaction failure. Skipped without DATABASE_URL.
const hasDb = !!process.env.DATABASE_URL;

const OPEN_ID = "cascade-del-test-user";
let eventId = 0;
let userId = 0;
let tripId = 0;
const resIds: number[] = [];
const payIds: number[] = [];

async function seed() {
  const db = await getDb();
  if (!db) return;
  await db.insert(users).values({ openId: OPEN_ID, name: "Cascade 테스터", loginMethod: "seed", pointsBalance: 0 }).onDuplicateKeyUpdate({ set: { pointsBalance: 0 } });
  const [u] = await db.select().from(users).where(eq(users.openId, OPEN_ID));
  userId = u.id;

  const ev = (await db.insert(events).values({
    title: "TEST-CASCADE 삭제 대상", category: "concert", eventDate: new Date("2026-09-01T10:00:00Z"),
    venue: "V", status: "active",
  })) as any;
  eventId = ev[0].insertId;

  const tr = (await db.insert(trips).values({
    eventId, mode: "bus", status: "collecting", minCount: 1, maxCount: 45, currentCount: 3,
    price: 30000, departureAt: new Date("2026-09-01T07:00:00Z"),
  })) as any;
  tripId = tr[0].insertId;

  // 2 reservations for the SAME user (to test dedup) + points used on one.
  for (const [seats, pointsUsed] of [[1, 2000], [2, 0]] as const) {
    const r = (await db.insert(reservations).values({
      userId, tripId, seats, pointsUsed, passengerName: "C", passengerPhone: "010-0000-0000",
    })) as any;
    const rid = r[0].insertId;
    resIds.push(rid);
    // Paid mock payment: fare - pointsUsed as totalAmount, items fare + discount.
    const fare = 30000 * seats;
    const total = fare - pointsUsed;
    const p = (await db.insert(payments).values({
      reservationId: rid, totalAmount: total, status: "paid", method: "mock", chargeType: "prepaid", paidAt: new Date(),
    })) as any;
    const pid = p[0].insertId;
    payIds.push(pid);
    await db.insert(paymentItems).values({ paymentId: pid, type: "fare", amount: fare, label: "요금" });
    if (pointsUsed > 0) await db.insert(paymentItems).values({ paymentId: pid, type: "discount", amount: -pointsUsed, label: "포인트" });
  }
}

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  if (payIds.length) await db.delete(paymentItems).where(inArray(paymentItems.paymentId, payIds));
  if (resIds.length) await db.delete(payments).where(inArray(payments.reservationId, resIds));
  await db.delete(reservations).where(eq(reservations.tripId, tripId || -1));
  await db.delete(boardingPoints).where(eq(boardingPoints.tripId, tripId || -1));
  await db.delete(trips).where(eq(trips.eventId, eventId || -1));
  await db.delete(points).where(eq(points.userId, userId || -1));
  await db.delete(events).where(eq(events.id, eventId || -1));
  await db.delete(users).where(eq(users.id, userId || -1));
  resIds.length = 0; payIds.length = 0;
}

describe.skipIf(!hasDb)("cascadeDeleteEventWithRefunds (real DB)", () => {
  beforeEach(async () => { await cleanup(); await seed(); });
  afterEach(cleanup);

  it("full-refunds all paid reservations (no fee), soft-deletes, restores points, dedupes recipients", async () => {
    const db = await getDb();
    if (!db) return;

    const result = await cascadeDeleteEventWithRefunds(eventId);

    // Full refund = sum of totalAmounts: (30000-2000) + (60000-0), no fee.
    expect(result.reservationCount).toBe(2);
    expect(result.totalRefund).toBe(28000 + 60000);
    expect(result.pointsRefunded).toBe(2000);
    // Both reservations belong to one user → a single recipient.
    expect(result.recipients).toHaveLength(1);
    expect(result.recipients[0].userId).toBe(userId);
    // Mock payments → no toss jobs.
    expect(result.tossRefundJobs).toHaveLength(0);

    // DB state committed.
    const [ev] = await db.select().from(events).where(eq(events.id, eventId));
    expect(ev.status).toBe("deleted");
    const trs = await db.select().from(trips).where(eq(trips.eventId, eventId));
    expect(trs.every((t) => t.status === "cancelled")).toBe(true);
    const pays = await db.select().from(payments).where(inArray(payments.id, payIds));
    expect(pays.every((p) => p.status === "cancelled" && p.refundedAmount === p.totalAmount)).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u.pointsBalance).toBe(2000); // restored
    const ledger = await db.select().from(points).where(and(eq(points.userId, userId), eq(points.type, "refund")));
    expect(ledger).toHaveLength(1);
  });

  it("rolls back everything when the transaction fails mid-way", async () => {
    const db = await getDb();
    if (!db) return;

    await expect(
      cascadeDeleteEventWithRefunds(eventId, { failBeforeCommit: () => { throw new Error("forced failure"); } })
    ).rejects.toThrow("forced failure");

    // Nothing changed.
    const [ev] = await db.select().from(events).where(eq(events.id, eventId));
    expect(ev.status).toBe("active");
    const trs = await db.select().from(trips).where(eq(trips.eventId, eventId));
    expect(trs.every((t) => t.status === "collecting")).toBe(true);
    const pays = await db.select().from(payments).where(inArray(payments.id, payIds));
    expect(pays.every((p) => p.status === "paid")).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u.pointsBalance).toBe(0); // not restored
  });
});
