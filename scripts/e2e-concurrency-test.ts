/* eslint-disable no-console */
import "dotenv/config";
import { appRouter } from "../server/routers";
import * as db from "../server/db";
import { createPool } from "mysql2/promise";
import type { User } from "../drizzle/schema";

function fakeReqRes() {
  return { req: {} as any, res: {} as any };
}

function callerFor(user: User | null) {
  return appRouter.createCaller({ ...fakeReqRes(), user });
}

async function main() {
  console.log("--- Seeding test data ---");

  const adminOpenId = "e2e-concurrency-admin";
  await db.upsertUser({ openId: adminOpenId, name: "E2E Concurrency Admin", role: "admin", lastSignedIn: new Date() });
  const adminUser = await db.getUserByOpenId(adminOpenId);
  if (!adminUser) throw new Error("failed to create admin user");

  const riderOpenIds = ["e2e-concurrency-rider-1", "e2e-concurrency-rider-2"];
  const riders: User[] = [];
  for (const openId of riderOpenIds) {
    await db.upsertUser({ openId, name: openId, lastSignedIn: new Date() });
    const u = await db.getUserByOpenId(openId);
    if (!u) throw new Error(`failed to create ${openId}`);
    riders.push(u);
  }

  const eventDate = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  const eventId = await db.createEvent({
    title: "E2E-CONCURRENCY-TEST-이벤트",
    category: "concert",
    eventDate,
    venue: "테스트 공연장",
    creatorId: adminUser.id,
  });
  console.log(`Created event #${eventId}`);

  const adminCaller = callerFor(adminUser);

  // ─── Scenario 1: two concurrent requests race for the last seat ───────────
  console.log("\n--- Scenario 1: two concurrent requests for the last seat ---");
  const trip1 = await adminCaller.trips.create({
    eventId,
    mode: "bus",
    minCount: 100, // kept high so auto-confirm doesn't interfere with this scenario
    maxCount: 2,
    price: 10000,
    departureAt: eventDate.getTime(),
    isRoundTrip: false,
  });
  console.log(`Created trip1 #${trip1.id} (maxCount=2)`);

  // Fill to exactly 1 remaining seat first (sequential, not part of the race).
  await callerFor(riders[0]).reservations.create({
    tripId: trip1.id,
    seats: 1,
    passengerName: "Seed rider",
    passengerPhone: "010-0000-0000",
  });
  const beforeRace = await db.getTripById(trip1.id);
  console.log(`trip1 currentCount before race: ${beforeRace?.currentCount} (maxCount=2, 1 remaining)`);

  // Two different users race for the last seat at the same time.
  const raceResults = await Promise.allSettled([
    callerFor(riders[0]).reservations.create({
      tripId: trip1.id,
      seats: 1,
      passengerName: "Racer A",
      passengerPhone: "010-0000-0001",
    }),
    callerFor(riders[1]).reservations.create({
      tripId: trip1.id,
      seats: 1,
      passengerName: "Racer B",
      passengerPhone: "010-0000-0002",
    }),
  ]);

  const succeeded = raceResults.filter((r) => r.status === "fulfilled").length;
  const failed = raceResults.filter((r) => r.status === "rejected").length;
  console.log(`race result: succeeded=${succeeded} failed=${failed}`);
  raceResults.forEach((r, i) => {
    if (r.status === "rejected") console.log(`  racer ${i} rejected: ${(r.reason as Error)?.message}`);
  });

  const trip1After = await db.getTripById(trip1.id);
  const reservations1 = await db.getReservationsByTripId(trip1.id);
  console.log(`trip1 currentCount after race: ${trip1After?.currentCount} (expected 2, maxCount=2)`);
  console.log(`reservation rows for trip1: ${reservations1.length} (expected 2)`);

  const noOverbooking =
    succeeded === 1 && failed === 1 && trip1After?.currentCount === 2 && reservations1.length === 2;

  // ─── Scenario 2: confirm transition fires exactly once under concurrency ──
  console.log("\n--- Scenario 2: confirmTripIfCollecting concurrency ---");
  const trip2 = await adminCaller.trips.create({
    eventId,
    mode: "bus",
    minCount: 2,
    maxCount: 50,
    price: 10000,
    departureAt: eventDate.getTime(),
    isRoundTrip: false,
  });
  console.log(`Created trip2 #${trip2.id} (starts in "collecting")`);

  const confirmResults = await Promise.all([
    db.confirmTripIfCollecting(trip2.id),
    db.confirmTripIfCollecting(trip2.id),
    db.confirmTripIfCollecting(trip2.id),
  ]);
  const confirmedCount = confirmResults.filter(Boolean).length;
  console.log(`confirmTripIfCollecting results: ${JSON.stringify(confirmResults)} (expected exactly one true)`);

  const trip2After = await db.getTripById(trip2.id);
  const confirmFiresExactlyOnce = confirmedCount === 1 && trip2After?.status === "confirmed";

  const allPassed = noOverbooking && confirmFiresExactlyOnce;

  console.log("\n=== CHECKS ===");
  console.log(`noOverbooking: ${noOverbooking}`);
  console.log(`confirmFiresExactlyOnce: ${confirmFiresExactlyOnce}`);
  console.log(`\n=== RESULT: ${allPassed ? "PASS" : "FAIL"} ===`);

  console.log("\n--- Cleanup ---");
  await cleanup(eventId);
  console.log("Cleanup done.");

  if (!allPassed) process.exit(1);
}

async function cleanup(eventId: number) {
  const pool = createPool(db.buildMysqlPoolConfig(process.env.DATABASE_URL!));
  const conn = await pool.getConnection();
  try {
    const trips = await conn.query("SELECT id FROM trips WHERE eventId = ?", [eventId]);
    const tripIds = (trips[0] as any[]).map((r) => r.id);
    for (const tripId of tripIds) {
      await conn.query(
        "DELETE FROM payment_items WHERE paymentId IN (SELECT id FROM payments WHERE reservationId IN (SELECT id FROM reservations WHERE tripId = ?))",
        [tripId]
      );
      await conn.query(
        "DELETE FROM payments WHERE reservationId IN (SELECT id FROM reservations WHERE tripId = ?)",
        [tripId]
      );
      await conn.query("DELETE FROM reservations WHERE tripId = ?", [tripId]);
    }
    await conn.query("DELETE FROM trips WHERE eventId = ?", [eventId]);
    await conn.query("DELETE FROM events WHERE id = ?", [eventId]);
    await conn.query("DELETE FROM users WHERE openId LIKE 'e2e-concurrency-%'");
  } finally {
    conn.release();
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("E2E concurrency test failed:", err);
    process.exit(1);
  });
