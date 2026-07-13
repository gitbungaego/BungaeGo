import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "mysql2/promise";
import * as db from "../db";
import { appRouter } from "../routers";
import type { ThemeConfig } from "@shared/types";
import type { TrpcContext } from "../_core/context";
import type { User } from "../../drizzle/schema";

// 실 DB 좌석 락(SELECT ... FOR UPDATE) 위에서 성별 정원이 지켜지는지 검증한다.
// DATABASE_URL 없으면(CI) 스킵, 로컬 bungaego_dev로 실행.
// 기존 단일정원 경쟁 테스트(scripts/e2e-concurrency-test.ts)의 성별 버전.
const hasDb = !!process.env.DATABASE_URL;

function caller(user: User) {
  return appRouter.createCaller({
    user,
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as unknown as TrpcContext);
}

async function makeVerifiedMale(openId: string): Promise<User> {
  await db.upsertUser({ openId, name: openId, lastSignedIn: new Date() });
  const user = await db.getUserByOpenId(openId);
  if (!user) throw new Error(`failed to create ${openId}`);
  // 이미 프로필 있으면 재사용(멱등).
  const existing = await db.getBungaetingProfileByUserId(user.id);
  if (!existing) {
    await db.createBungaetingProfile({
      userId: user.id, nickname: openId, gender: "M", birthDate: "1994-01-01",
      verifiedAt: new Date(), verificationProvider: "mock", tosAgreedAt: new Date(), status: "active",
    });
  }
  return user;
}

describe.skipIf(!hasDb)("반반 모드 성별 좌석 경쟁 (real DB)", () => {
  let tripId: number;
  let eventId: number;
  let male1: User;
  let male2: User;
  const createdUserIds: number[] = [];

  beforeAll(async () => {
    male1 = await makeVerifiedMale("bt-race-m1");
    male2 = await makeVerifiedMale("bt-race-m2");
    createdUserIds.push(male1.id, male2.id);

    const eventDate = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    eventId = await db.createEvent({
      title: "BT-RACE-이벤트", category: "concert", eventDate, venue: "테스트", creatorId: male1.id,
    });

    // 반반 모드, 남 1석·여 1석. minCount는 높여 자동확정 간섭 배제. 나이 무제한.
    const cfg: ThemeConfig = { genderMode: "half", genderCap: { M: 1, F: 1 }, ageMin: null, ageMax: null };
    tripId = await db.createTrip({
      eventId, mode: "bus", minCount: 100, maxCount: 2, price: 40000,
      departureAt: eventDate, isRoundTrip: false, theme: "bungaeting", themeConfig: cfg,
    });
  });

  afterAll(async () => {
    // 정리: 테스트가 만든 행만 raw SQL로 제거 (db.ts에 테스트 전용 delete를 두지 않음).
    const url = new URL(process.env.DATABASE_URL as string);
    const conn = await createConnection({
      host: url.hostname, port: Number(url.port || 3306),
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\/+/, ""),
      ssl: url.searchParams.get("ssl") === "true" ? { rejectUnauthorized: true } : undefined,
    });
    try {
      await conn.query(
        "DELETE p FROM payments p JOIN reservations r ON p.reservationId = r.id WHERE r.tripId = ?",
        [tripId]
      );
      await conn.query("DELETE FROM reservations WHERE tripId = ?", [tripId]);
      await conn.query("DELETE FROM trips WHERE id = ?", [tripId]);
      await conn.query("DELETE FROM events WHERE id = ?", [eventId]);
      if (createdUserIds.length) {
        await conn.query("DELETE FROM bungaeting_profiles WHERE userId IN (?)", [createdUserIds]);
        await conn.query("DELETE FROM points WHERE userId IN (?)", [createdUserIds]);
        await conn.query("DELETE FROM users WHERE id IN (?)", [createdUserIds]);
      }
    } finally {
      await conn.end();
    }
  });

  it("남 1석에 남자 2명이 동시 예약 → 정확히 1명만 성공", async () => {
    const results = await Promise.allSettled([
      caller(male1).reservations.create({ tripId, seats: 1, passengerName: "M1", passengerPhone: "010-0000-0001" }),
      caller(male2).reservations.create({ tripId, seats: 1, passengerName: "M2", passengerPhone: "010-0000-0002" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // 실패는 좌석 부족(BAD_REQUEST) 이어야 한다.
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ message: "좌석이 부족합니다." });

    // 트립 좌석은 정확히 1석만 찼다.
    const trip = await db.getTripById(tripId);
    expect(trip?.currentCount).toBe(1);
    const reservations = await db.getReservationsWithPaymentsByTripId(tripId);
    expect(reservations.filter((r) => r.status !== "cancelled")).toHaveLength(1);
  });
});
