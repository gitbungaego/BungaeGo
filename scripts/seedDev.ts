/**
 * 로컬 개발 DB 전용 시드 (다양한 상태 커버용)
 *
 * scripts/seed.ts(운영 온보딩용 실사 이벤트 10건)와는 별개로, 매칭/결제/관리자
 * 화면에서 상태별 분기를 눈으로 확인하기 위한 최소 시나리오 4건을 만듭니다:
 * 모집중 셔틀, 확정된 셔틀 + 예약 2건, 자동매칭 ON 이벤트.
 *
 * 실행: DATABASE_URL=<로컬 dev DB> pnpm tsx scripts/seedDev.ts
 * 제목/openId 기준으로 존재 여부를 먼저 확인하므로 재실행해도 안전합니다(idempotent).
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import { createPool } from "mysql2/promise";
import { buildMysqlPoolConfig } from "../server/db";
import {
  boardingPoints,
  events,
  payments,
  paymentItems,
  reservations,
  trips,
  users,
  type InsertBoardingPoint,
  type InsertEvent,
  type InsertPayment,
  type InsertPaymentItem,
  type InsertReservation,
  type InsertTrip,
  type InsertUser,
} from "../drizzle/schema";

const kst = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, mo - 1, d, h - 9, mi));

const TEST_USER_OPEN_ID = "local-dev-tester";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seedDev] DATABASE_URL 환경 변수가 설정되어 있지 않습니다.");
    process.exit(1);
  }
  const db = drizzle(createPool(buildMysqlPoolConfig(process.env.DATABASE_URL)));

  // ── 테스트 유저 (예약 소유자) ──────────────────────────────────────────────
  let testUserId: number;
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.openId, TEST_USER_OPEN_ID))
    .limit(1);
  if (existingUser.length > 0) {
    testUserId = existingUser[0].id;
    console.log(`[seedDev] SKIP (이미 존재): 테스트 유저 #${testUserId}`);
  } else {
    const userData: InsertUser = {
      openId: TEST_USER_OPEN_ID,
      name: "로컬 테스트 유저",
      loginMethod: "local-dev",
      role: "user",
    };
    const result = await db.insert(users).values(userData);
    testUserId = (result[0] as any).insertId as number;
    console.log(`[seedDev] USER #${testUserId} 생성: ${TEST_USER_OPEN_ID}`);
  }

  async function ensureEvent(eventData: InsertEvent): Promise<number | null> {
    const existing = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.title, eventData.title))
      .limit(1);
    if (existing.length > 0) {
      console.log(`[seedDev] SKIP (이미 존재): ${eventData.title}`);
      return null;
    }
    const result = await db.insert(events).values(eventData);
    const eventId = (result[0] as any).insertId as number;
    console.log(`[seedDev] EVENT #${eventId} 생성: ${eventData.title}`);
    return eventId;
  }

  // ── 1. 모집중 셔틀 ──────────────────────────────────────────────────────────
  const collectingEventId = await ensureEvent({
    title: "[개발] 모집중 셔틀 테스트",
    category: "concert",
    eventDate: kst(2026, 9, 20, 19, 0),
    venue: "테스트 공연장 A",
    status: "active",
    organizerName: "번개GO 운영팀",
    creatorId: null,
  });
  if (collectingEventId) {
    const tripData: InsertTrip = {
      eventId: collectingEventId,
      mode: "bus",
      status: "collecting",
      minCount: 15,
      maxCount: 45,
      currentCount: 4,
      price: 20000,
      departureAt: kst(2026, 9, 20, 16, 0),
      returnAt: kst(2026, 9, 20, 22, 30),
      isRoundTrip: true,
      notes: "모집중 상태 확인용",
    };
    const tripResult = await db.insert(trips).values(tripData);
    const tripId = (tripResult[0] as any).insertId as number;
    const bpData: InsertBoardingPoint = {
      tripId,
      name: "테스트 승차장 A",
      order: 0,
      pickupTime: kst(2026, 9, 20, 16, 0),
    };
    await db.insert(boardingPoints).values(bpData);
    console.log(`[seedDev]   └ TRIP #${tripId} (collecting)`);
  }

  // ── 2. 확정된 셔틀 + 예약 2건 ────────────────────────────────────────────────
  const confirmedEventId = await ensureEvent({
    title: "[개발] 확정 셔틀 테스트",
    category: "concert",
    eventDate: kst(2026, 9, 21, 19, 0),
    venue: "테스트 공연장 B",
    status: "active",
    organizerName: "번개GO 운영팀",
    creatorId: null,
  });
  if (confirmedEventId) {
    const tripData: InsertTrip = {
      eventId: confirmedEventId,
      mode: "bus",
      status: "confirmed",
      minCount: 15,
      maxCount: 45,
      currentCount: 2,
      price: 22000,
      departureAt: kst(2026, 9, 21, 16, 0),
      returnAt: kst(2026, 9, 21, 22, 30),
      isRoundTrip: true,
      notes: "확정 상태 + 예약 2건 확인용",
    };
    const tripResult = await db.insert(trips).values(tripData);
    const tripId = (tripResult[0] as any).insertId as number;
    const bpResult = await db.insert(boardingPoints).values({
      tripId,
      name: "테스트 승차장 B",
      order: 0,
      pickupTime: kst(2026, 9, 21, 16, 0),
    } satisfies InsertBoardingPoint);
    const boardingPointId = (bpResult[0] as any).insertId as number;
    console.log(`[seedDev]   └ TRIP #${tripId} (confirmed)`);

    for (let i = 0; i < 2; i++) {
      const reservationData: InsertReservation = {
        userId: testUserId,
        tripId,
        boardingPointId,
        seats: 1,
        passengerName: `테스트 승객 ${i + 1}`,
        passengerPhone: "010-0000-0000",
      };
      const resResult = await db.insert(reservations).values(reservationData);
      const reservationId = (resResult[0] as any).insertId as number;

      const paymentData: InsertPayment = {
        reservationId,
        totalAmount: 22000,
        status: "paid",
        method: "mock",
        chargeType: "prepaid",
        orderId: `dev-seed-${tripId}-${i + 1}`,
      };
      const paymentResult = await db.insert(payments).values(paymentData);
      const paymentId = (paymentResult[0] as any).insertId as number;

      const itemData: InsertPaymentItem = {
        paymentId,
        type: "fare",
        amount: 22000,
        label: "왕복 요금",
      };
      await db.insert(paymentItems).values(itemData);

      console.log(`[seedDev]     └ RESERVATION #${reservationId} + PAYMENT #${paymentId} (paid)`);
    }
  }

  // ── 3. 자동매칭 ON 이벤트 ────────────────────────────────────────────────────
  const autoMatchEventId = await ensureEvent({
    title: "[개발] 자동매칭 ON 테스트",
    category: "concert",
    eventDate: kst(2026, 9, 22, 19, 0),
    venue: "테스트 공연장 C",
    status: "active",
    organizerName: "번개GO 운영팀",
    creatorId: null,
    autoMatchEnabled: true,
    autoMatchPricePerSeat: 21000,
  });
  if (autoMatchEventId) {
    console.log(`[seedDev]   └ autoMatchEnabled=true, price/seat=21000`);
  }

  console.log("\n[seedDev] 완료");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seedDev] 실패:", err);
  process.exit(1);
});
