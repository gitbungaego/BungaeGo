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

  const adminOpenId = "e2e-admin";
  await db.upsertUser({ openId: adminOpenId, name: "E2E Admin", role: "admin", lastSignedIn: new Date() });
  const adminUser = await db.getUserByOpenId(adminOpenId);
  if (!adminUser) throw new Error("failed to create admin user");

  const riderCount = 26;
  const riders: User[] = [];
  for (let i = 0; i < riderCount; i++) {
    const openId = `e2e-rider-${i}`;
    await db.upsertUser({ openId, name: `Rider ${i}`, lastSignedIn: new Date() });
    const u = await db.getUserByOpenId(openId);
    if (!u) throw new Error(`failed to create rider ${i}`);
    riders.push(u);
  }
  console.log(`Created ${riders.length} rider users + 1 admin`);

  const venue = { lat: 37.4, lng: 127.0 };
  const eventDate = new Date(Date.now() + 14 * 24 * 3600 * 1000); // 2 weeks out
  const eventId = await db.createEvent({
    title: "E2E-TEST-이벤트",
    category: "concert",
    eventDate,
    venue: "테스트 공연장",
    lat: String(venue.lat),
    lng: String(venue.lng),
    autoMatchEnabled: true,
    autoMatchPricePerSeat: 15000,
    creatorId: adminUser.id,
  });
  console.log(`Created event #${eventId}`);

  // Two target-arrival buckets, 3 geographic clusters, plus isolated noise points.
  const bucketA = new Date(eventDate.getTime() - 3 * 3600 * 1000); // 3h before event
  const bucketB = new Date(eventDate.getTime() - 1.5 * 3600 * 1000); // 1.5h before event

  function tightGroup(center: { lat: number; lng: number }, count: number) {
    const pts: Array<{ lat: number; lng: number }> = [];
    for (let i = 0; i < count; i++) {
      pts.push({ lat: center.lat + (i - count / 2) * 0.0003, lng: center.lng });
    }
    return pts;
  }

  const clusterA1 = tightGroup({ lat: 37.5, lng: 127.0 }, 10).map((p) => ({ ...p, arrival: bucketA }));
  const clusterA2 = tightGroup({ lat: 37.55, lng: 127.08 }, 10).map((p) => ({ ...p, arrival: bucketA }));
  const clusterB1 = tightGroup({ lat: 37.6, lng: 127.15 }, 4).map((p) => ({ ...p, arrival: bucketB }));
  const isolated = [{ lat: 40.0, lng: 130.0, arrival: bucketA }, { lat: 41.0, lng: 131.0, arrival: bucketA }];

  const allPoints = [...clusterA1, ...clusterA2, ...clusterB1, ...isolated];
  if (allPoints.length !== riders.length) {
    throw new Error(`point count ${allPoints.length} != rider count ${riders.length}`);
  }

  const createdRequestIds: number[] = [];
  for (let i = 0; i < riders.length; i++) {
    const caller = callerFor(riders[i]);
    const point = allPoints[i];
    const res = await caller.rideRequests.create({
      eventId,
      originAddress: `테스트 출발지 ${i}`,
      originLat: String(point.lat),
      originLng: String(point.lng),
      targetArrivalAt: point.arrival.getTime(),
      seats: 1,
      passengerName: `Rider ${i}`,
      passengerPhone: "010-0000-0000",
    });
    createdRequestIds.push(res.id);
  }
  console.log(`Created ${createdRequestIds.length} ride requests`);

  // Force clusterA1 and clusterA2 (10 seats each) onto separate buses, and lower
  // minPts so clusterB1 (4 riders) is also viable — exercises multi-route + the
  // failed/merge path (the 2 isolated far-away riders should still fail) all at once.
  const testParams = { maxCapacitySeats: 15, minCapacitySeats: 8, minPts: 4 };

  console.log("\n--- Preview ---");
  const adminCaller = callerFor(adminUser);
  const preview = await adminCaller.admin.matching.preview({ eventId, params: testParams });
  console.log(
    `clusters=${preview.clusters.length} routes=${preview.routes.length} failed=${preview.failedRequestIds.length}`
  );
  if (preview.routes.length < 3) throw new Error(`expected at least 3 routes in preview, got ${preview.routes.length}`);
  if (preview.failedRequestIds.length < 2) throw new Error("expected the 2 isolated far-away riders to fail to match");

  console.log("\n--- Commit #1 ---");
  const commit1 = await adminCaller.admin.matching.commit({ eventId, params: testParams });
  console.log(`createdTripCount=${commit1.createdTripCount} matchedRequestCount=${commit1.matchedRequestCount}`);
  const tripsAfterCommit1 = await db.getTripsByEventId(eventId);
  console.log(`trips in DB after commit #1: ${tripsAfterCommit1.length}`);
  if (tripsAfterCommit1.length !== commit1.createdTripCount) {
    throw new Error("trip count mismatch after commit #1");
  }

  console.log("\n--- Commit #2 (idempotency check) ---");
  // Some routes from commit #1 may have already auto-confirmed (>= minCapacitySeats)
  // and are correctly left untouched; only still-"collecting" trips get rebuilt.
  // The invariant to check is that total trip count doesn't grow across repeated commits.
  const commit2 = await adminCaller.admin.matching.commit({ eventId, params: testParams });
  const tripsAfterCommit2 = await db.getTripsByEventId(eventId);
  console.log(`trips in DB after commit #2: ${tripsAfterCommit2.length} (createdTripCount=${commit2.createdTripCount})`);
  if (tripsAfterCommit2.length !== tripsAfterCommit1.length) {
    throw new Error(
      `commit #2 changed total trip count: ${tripsAfterCommit1.length} -> ${tripsAfterCommit2.length}`
    );
  }
  const noDanglingRequests = (await db.getRideRequestsByEventId(eventId)).every((r) => {
    if (r.status !== "route_confirmed") return true;
    return tripsAfterCommit2.some((t) => t.id === r.tripId);
  });
  if (!noDanglingRequests) {
    throw new Error("found route_confirmed ride requests pointing at a deleted trip");
  }

  const requestsAfterCommit2 = await db.getRideRequestsByEventId(eventId);
  const routeConfirmed = requestsAfterCommit2.filter((r) => r.status === "route_confirmed").length;
  const stillPending = requestsAfterCommit2.filter((r) => r.status === "pending").length;
  console.log(`route_confirmed=${routeConfirmed} pending=${stillPending}`);

  console.log("\n--- Freeze ---");
  const freezeResult = await adminCaller.admin.matching.freeze({ eventId });
  console.log(`refundedCount=${freezeResult.refundedCount}`);

  const requestsAfterFreeze = await db.getRideRequestsByEventId(eventId);
  const failedRefunded = requestsAfterFreeze.filter((r) => r.status === "failed_refunded").length;
  console.log(`failed_refunded=${failedRefunded}`);

  console.log("\n--- Post-freeze guard checks ---");
  let blockedCommit = false;
  try {
    await adminCaller.admin.matching.commit({ eventId });
  } catch (e) {
    blockedCommit = true;
  }
  console.log(`commit blocked after freeze: ${blockedCommit}`);

  let blockedCreate = false;
  try {
    await callerFor(riders[0]).rideRequests.create({
      eventId,
      originLat: "37.5",
      originLng: "127.0",
      targetArrivalAt: bucketA.getTime(),
      seats: 1,
      passengerName: "late rider",
      passengerPhone: "010-0000-0000",
    });
  } catch (e) {
    blockedCreate = true;
  }
  console.log(`create blocked after freeze: ${blockedCreate}`);

  const allPassed =
    preview.routes.length >= 3 &&
    tripsAfterCommit1.length === commit1.createdTripCount &&
    tripsAfterCommit2.length === tripsAfterCommit1.length &&
    noDanglingRequests &&
    routeConfirmed > 0 &&
    failedRefunded >= 2 &&
    blockedCommit &&
    blockedCreate;

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
      await conn.query("DELETE FROM boarding_points WHERE tripId = ?", [tripId]);
    }
    await conn.query("DELETE FROM trips WHERE eventId = ?", [eventId]);
    await conn.query(
      "DELETE FROM points WHERE refId IN (SELECT CAST(id AS CHAR) FROM ride_requests WHERE eventId = ?)",
      [eventId]
    );
    await conn.query("DELETE FROM ride_requests WHERE eventId = ?", [eventId]);
    await conn.query("DELETE FROM clusters WHERE eventId = ?", [eventId]);
    await conn.query("DELETE FROM events WHERE id = ?", [eventId]);
    await conn.query("DELETE FROM users WHERE openId LIKE 'e2e-%'");
  } finally {
    conn.release();
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("E2E test failed:", err);
    process.exit(1);
  });
