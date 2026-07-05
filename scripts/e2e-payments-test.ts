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

  const adminOpenId = "e2e-payments-admin";
  await db.upsertUser({ openId: adminOpenId, name: "E2E Payments Admin", role: "admin", lastSignedIn: new Date() });
  const adminUser = await db.getUserByOpenId(adminOpenId);
  if (!adminUser) throw new Error("failed to create admin user");

  const rider1OpenId = "e2e-payments-rider-1";
  const rider2OpenId = "e2e-payments-rider-2";
  await db.upsertUser({ openId: rider1OpenId, name: "Rider 1", lastSignedIn: new Date() });
  await db.upsertUser({ openId: rider2OpenId, name: "Rider 2", lastSignedIn: new Date() });
  let rider1 = await db.getUserByOpenId(rider1OpenId);
  const rider2 = await db.getUserByOpenId(rider2OpenId);
  if (!rider1 || !rider2) throw new Error("failed to create rider users");

  await db.addPoints(rider1.id, 10000, "admin_grant", "e2e seed points");
  rider1 = await db.getUserByOpenId(rider1OpenId);
  if (!rider1) throw new Error("rider1 disappeared after addPoints");
  console.log(`rider1 pointsBalance after seed: ${rider1.pointsBalance}`);

  const eventDate = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  const eventId = await db.createEvent({
    title: "E2E-PAYMENTS-TEST-이벤트",
    category: "concert",
    eventDate,
    venue: "테스트 공연장",
    creatorId: adminUser.id,
  });
  console.log(`Created event #${eventId}`);

  const adminCaller = callerFor(adminUser);
  const rider1Caller = callerFor(rider1);
  const rider2Caller = callerFor(rider2);

  // ─── Trip A: reaches minCount and auto-confirms ────────────────────────────
  console.log("\n--- Trip A: create + reserve + auto-confirm ---");
  const tripAPrice = 10000;
  const tripA = await adminCaller.trips.create({
    eventId,
    mode: "bus",
    minCount: 2,
    maxCount: 10,
    price: tripAPrice,
    departureAt: eventDate.getTime(),
    isRoundTrip: false,
  });
  console.log(`Created trip A #${tripA.id}`);

  const pointsUsedRes1 = 3000;
  const res1 = await rider1Caller.reservations.create({
    tripId: tripA.id,
    seats: 1,
    passengerName: "Rider 1",
    passengerPhone: "010-0000-0001",
    pointsUsed: pointsUsedRes1,
  });
  console.log(`Created reservation #${res1.id} (rider1, pointsUsed=${pointsUsedRes1})`);

  const payment1 = await db.getLatestPaymentByReservationId(res1.id);
  if (!payment1) throw new Error("payment1 not created");
  const items1 = await db.getPaymentItemsByPaymentId(payment1.id);
  const items1Sum = items1.reduce((s, i) => s + i.amount, 0);
  const expectedTotal1 = tripAPrice * 1 - pointsUsedRes1;
  console.log(
    `payment1.totalAmount=${payment1.totalAmount} items sum=${items1Sum} expected=${expectedTotal1} status=${payment1.status} method=${payment1.method} chargeType=${payment1.chargeType}`
  );
  const paymentItemSumMatchesTotal = items1Sum === payment1.totalAmount && payment1.totalAmount === expectedTotal1;

  const resById1 = await db.getReservationById(res1.id);
  console.log(
    `getReservationById flatten check: status=${resById1?.status} totalAmount=${resById1?.totalAmount} paymentMethod=${resById1?.paymentMethod}`
  );
  const flattenLooksRight =
    resById1?.status === "paid" && resById1?.totalAmount === expectedTotal1 && resById1?.paymentMethod === "mock";

  const res2 = await rider2Caller.reservations.create({
    tripId: tripA.id,
    seats: 1,
    passengerName: "Rider 2",
    passengerPhone: "010-0000-0002",
  });
  console.log(`Created reservation #${res2.id} (rider2, no points)`);

  const tripAAfter = await db.getTripById(tripA.id);
  console.log(`trip A status after reaching minCount: ${tripAAfter?.status} (currentCount=${tripAAfter?.currentCount})`);
  const tripAConfirmed = tripAAfter?.status === "confirmed";

  // ─── ConfirmPolicy availability exposed via trips.byId ─────────────────────
  console.log("\n--- trips.byId availability field ---");
  const tripAViaApi = await rider1Caller.trips.byId({ id: tripA.id });
  console.log(`availability=${JSON.stringify((tripAViaApi as any).availability)}`);
  const availabilityLooksRight =
    (tripAViaApi as any).availability?.total === 10 && (tripAViaApi as any).availability?.remaining === 8;

  let seatOverflowBlocked = false;
  try {
    await rider2Caller.reservations.create({
      tripId: tripA.id,
      seats: 9,
      passengerName: "Rider 2",
      passengerPhone: "010-0000-0002",
    });
  } catch (e) {
    seatOverflowBlocked = true;
  }
  console.log(`seat overflow (9 seats, 8 remaining) correctly blocked: ${seatOverflowBlocked}`);

  // ─── User cancels reservation 1: payment cancelled + points refunded ───────
  console.log("\n--- User cancels reservation 1 ---");
  const rider1BalanceBeforeCancel = (await db.getUserByOpenId(rider1OpenId))!.pointsBalance;
  await rider1Caller.reservations.cancel({ id: res1.id, reason: "일정이 안 맞아요" });
  const payment1AfterCancel = await db.getLatestPaymentByReservationId(res1.id);
  const rider1AfterCancel = await db.getUserByOpenId(rider1OpenId);
  console.log(
    `payment1 after cancel: status=${payment1AfterCancel?.status} cancelReason=${payment1AfterCancel?.cancelReason} cancelNote=${payment1AfterCancel?.cancelNote}`
  );
  console.log(`rider1 pointsBalance: ${rider1BalanceBeforeCancel} -> ${rider1AfterCancel?.pointsBalance}`);
  const userCancelWorked =
    payment1AfterCancel?.status === "cancelled" &&
    payment1AfterCancel?.cancelReason === "user_request" &&
    rider1AfterCancel?.pointsBalance === rider1BalanceBeforeCancel + pointsUsedRes1;

  // ─── Trip B: never reaches minCount, admin cancels -> auto-refund cascade ──
  console.log("\n--- Trip B: create + reserve + admin cancel (trip_not_confirmed cascade) ---");
  const tripBPrice = 8000;
  const tripB = await adminCaller.trips.create({
    eventId,
    mode: "van",
    minCount: 5,
    maxCount: 10,
    price: tripBPrice,
    departureAt: eventDate.getTime(),
    isRoundTrip: false,
  });
  console.log(`Created trip B #${tripB.id}`);

  const pointsUsedRes3 = 1000;
  const res3 = await rider1Caller.reservations.create({
    tripId: tripB.id,
    seats: 1,
    passengerName: "Rider 1",
    passengerPhone: "010-0000-0001",
    pointsUsed: pointsUsedRes3,
  });
  console.log(`Created reservation #${res3.id} on trip B (rider1, pointsUsed=${pointsUsedRes3})`);

  const rider1BalanceBeforeTripCancel = (await db.getUserByOpenId(rider1OpenId))!.pointsBalance;
  await adminCaller.trips.updateStatus({ id: tripB.id, status: "cancelled" });

  const payment3AfterTripCancel = await db.getLatestPaymentByReservationId(res3.id);
  const rider1AfterTripCancel = await db.getUserByOpenId(rider1OpenId);
  console.log(
    `payment3 after trip cancel: status=${payment3AfterTripCancel?.status} cancelReason=${payment3AfterTripCancel?.cancelReason}`
  );
  console.log(`rider1 pointsBalance: ${rider1BalanceBeforeTripCancel} -> ${rider1AfterTripCancel?.pointsBalance}`);
  const tripCancelCascadeWorked =
    payment3AfterTripCancel?.status === "cancelled" &&
    payment3AfterTripCancel?.cancelReason === "trip_not_confirmed" &&
    rider1AfterTripCancel?.pointsBalance === rider1BalanceBeforeTripCancel + pointsUsedRes3;

  // ─── admin.stats revenueByItemType invariant ───────────────────────────────
  console.log("\n--- admin.stats revenueByItemType ---");
  const stats = await adminCaller.admin.stats();
  const revenueByTypeSum =
    stats.revenueByItemType.fare + stats.revenueByItemType.theme_fee + stats.revenueByItemType.discount;
  console.log(`totalRevenue=${stats.totalRevenue} revenueByItemType=${JSON.stringify(stats.revenueByItemType)}`);
  const revenueInvariantHolds = revenueByTypeSum === stats.totalRevenue;

  const allPassed =
    paymentItemSumMatchesTotal &&
    flattenLooksRight &&
    tripAConfirmed &&
    availabilityLooksRight &&
    seatOverflowBlocked &&
    userCancelWorked &&
    tripCancelCascadeWorked &&
    revenueInvariantHolds;

  console.log("\n=== CHECKS ===");
  console.log(`paymentItemSumMatchesTotal: ${paymentItemSumMatchesTotal}`);
  console.log(`flattenLooksRight: ${flattenLooksRight}`);
  console.log(`tripAConfirmed: ${tripAConfirmed}`);
  console.log(`availabilityLooksRight: ${availabilityLooksRight}`);
  console.log(`seatOverflowBlocked: ${seatOverflowBlocked}`);
  console.log(`userCancelWorked: ${userCancelWorked}`);
  console.log(`tripCancelCascadeWorked: ${tripCancelCascadeWorked}`);
  console.log(`revenueInvariantHolds: ${revenueInvariantHolds}`);
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
    await conn.query(
      "DELETE FROM points WHERE userId IN (SELECT id FROM users WHERE openId LIKE 'e2e-payments-%')"
    );
    await conn.query("DELETE FROM events WHERE id = ?", [eventId]);
    await conn.query("DELETE FROM users WHERE openId LIKE 'e2e-payments-%'");
  } finally {
    conn.release();
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("E2E payments test failed:", err);
    process.exit(1);
  });
