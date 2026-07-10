import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, persistMatchingCommit } from "./db";
import { clusters, reservations, trips } from "../drizzle/schema";
import type { RideRequest } from "../drizzle/schema";
import type { PipelineOutput } from "./matching/pipeline";

// Real-DB integration test: proves persistMatchingCommit rolls the whole
// matching persistence back when any step fails mid-transaction. Skipped when
// no DATABASE_URL is configured (e.g. CI without a DB); run locally with the
// dev database to exercise it.
const hasDb = !!process.env.DATABASE_URL;

// A throwaway event id far outside seeded ranges, so we never collide with
// real rows and cleanup is targeted.
const TEST_EVENT_ID = 990_101;

function fakeRequest(id: number): RideRequest {
  return {
    id,
    eventId: TEST_EVENT_ID,
    userId: 999_001,
    originAddress: null,
    originLat: "37.5000000",
    originLng: "127.0000000",
    targetArrivalAt: new Date("2026-08-20T10:00:00.000Z"),
    groupKey: null,
    clusterId: null,
    tripId: null,
    boardingPointId: null,
    reservationId: null,
    status: "pending",
    seats: 2,
    passengerName: "롤백 테스터",
    passengerPhone: "010-0000-0000",
    passengerEmail: null,
    referralCodeUsed: null,
    pointsUsed: 0,
    totalAmount: 40000,
    paymentMethod: "mock",
    refundedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as RideRequest;
}

// One viable cluster → one route with a single stop and one member. Enough to
// drive a trip + boarding point + reservation + payment insert inside the tx.
function syntheticOutput(): PipelineOutput {
  return {
    clusters: [
      {
        clusterId: -1,
        groupKey: "g1",
        memberRequestIds: [1],
        status: "viable",
        assignedStopId: null,
        assignedLat: 37.5,
        assignedLng: 127.0,
        isAdHocStop: true,
      },
    ],
    routes: [
      {
        groupKey: "g1",
        routeIndex: 0,
        stops: [{ clusterId: -1, lat: 37.5, lng: 127.0, seats: 2, order: 0, pickupTime: new Date("2026-08-20T08:00:00.000Z") }],
        totalSeats: 2,
        departureAt: new Date("2026-08-20T08:00:00.000Z"),
      },
    ],
    failedRequestIds: [],
  };
}

async function countPersisted() {
  const db = await getDb();
  if (!db) return { trips: 0, clusters: 0, reservations: 0 };
  const tripRows = await db.select({ id: trips.id }).from(trips).where(eq(trips.eventId, TEST_EVENT_ID));
  const clusterRows = await db.select({ id: clusters.id }).from(clusters).where(eq(clusters.eventId, TEST_EVENT_ID));
  const reservationRows = tripRows.length
    ? await db.select({ id: reservations.id }).from(reservations).where(eq(reservations.tripId, tripRows[0].id))
    : [];
  return { trips: tripRows.length, clusters: clusterRows.length, reservations: reservationRows.length };
}

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  const tripRows = await db.select({ id: trips.id }).from(trips).where(eq(trips.eventId, TEST_EVENT_ID));
  for (const t of tripRows) {
    await db.delete(reservations).where(eq(reservations.tripId, t.id));
  }
  await db.delete(trips).where(eq(trips.eventId, TEST_EVENT_ID));
  await db.delete(clusters).where(eq(clusters.eventId, TEST_EVENT_ID));
}

describe.skipIf(!hasDb)("persistMatchingCommit - transactional rollback (real DB)", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  const input = () => ({
    eventId: TEST_EVENT_ID,
    creatorId: 0,
    minCount: 1,
    maxCount: 45,
    finalPricePerSeat: 20000,
    output: syntheticOutput(),
    stopNameById: new Map<number, string>(),
    requestById: new Map([[1, fakeRequest(1)]]),
    tossPaymentByRequestId: new Map(),
  });

  it("commits trip + cluster + reservation when nothing fails", async () => {
    const result = await persistMatchingCommit(input());
    expect(result.createdTripCount).toBe(1);
    expect(result.matchedRequestCount).toBe(1);

    const persisted = await countPersisted();
    expect(persisted.trips).toBe(1);
    expect(persisted.clusters).toBe(1);
    expect(persisted.reservations).toBe(1);
  });

  it("rolls back everything when a step fails mid-transaction (DB left unchanged)", async () => {
    await expect(
      persistMatchingCommit(input(), {
        failAfterFirstTrip: () => {
          throw new Error("forced mid-transaction failure");
        },
      })
    ).rejects.toThrow("forced mid-transaction failure");

    const persisted = await countPersisted();
    expect(persisted).toEqual({ trips: 0, clusters: 0, reservations: 0 });
  });
});
