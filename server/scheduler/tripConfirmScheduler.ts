import { dMinusBoundaryUtc, isCreatedAfterOwnD5 } from "@shared/cancellationPolicy";
import {
  cancelTripIfCollecting,
  confirmTripIfCollecting,
  getEventById,
  getReservationsWithPaymentsByTripId,
  getTripsByStatus,
} from "../db";
import { getPolicy, type PolicyContext } from "../matching/confirmPolicy";
import { buildGenderMap } from "../bungaeting/policy";
import { cancelReservationsForTrip } from "../payments";
import { notifyTrip } from "../notify/tripMessenger";
import type { Trip, TripCancelReason } from "../../drizzle/schema";

const BUNGAETING_THEME = "bungaeting";

const D5_DAYS_BEFORE = 5;
export const SCHEDULER_INTERVAL_MS = 10 * 60 * 1000;

async function judgeTrip(trip: Trip, now: Date): Promise<void> {
  // Trips created after their own D-5 boundary have no future D-5 judgment
  // moment — they stay on the legacy instant-confirm-only path (see
  // maybeConfirmTrip in routers.ts) and are never auto-cancelled here.
  if (isCreatedAfterOwnD5(trip)) return;

  const boundary = dMinusBoundaryUtc(trip.departureAt, D5_DAYS_BEFORE);
  if (now.getTime() < boundary.getTime()) return;

  const policy = getPolicy(trip.theme);
  const tripReservations = await getReservationsWithPaymentsByTripId(trip.id);

  // 번개팅 회차는 성비 판정에 예약자 성별 맵이 필요하다 (spec §2-2: 최소인원 + 성비
  // 동시 판정). 표준 트립은 ctx 없이 기존 판정 그대로 — 회귀 방지.
  const ctx: PolicyContext | undefined =
    trip.theme === BUNGAETING_THEME
      ? { genderByUserId: await buildGenderMap(tripReservations) }
      : undefined;

  if (policy.canConfirm(trip, tripReservations, ctx)) {
    // 확정 시점 = 프로필 공개 시점 = 환불불가 시작점 = D-5 00:00 KST (셋이 동일 경계).
    const didConfirm = await confirmTripIfCollecting(trip.id);
    if (!didConfirm) return;
    const event = await getEventById(trip.eventId);
    await notifyTrip(
      trip.id,
      "tripConfirmed",
      { eventTitle: event?.title ?? "셔틀", departureAt: trip.departureAt },
      "all"
    ).catch((error) => console.warn("[tripConfirmScheduler] notifyTrip (confirmed) failed:", error));
    return;
  }

  // 번개팅은 성비/최소인원 미달을 gender_ratio_not_met로 구분(처리는 동일 전액환불).
  const cancelReason: TripCancelReason =
    trip.theme === BUNGAETING_THEME ? "gender_ratio_not_met" : "min_count_not_met";
  const didCancel = await cancelTripIfCollecting(trip.id, cancelReason);
  if (!didCancel) return;
  await cancelReservationsForTrip(trip);
  const event = await getEventById(trip.eventId);
  await notifyTrip(
    trip.id,
    "tripCancelled",
    { eventTitle: event?.title ?? "셔틀" },
    "all"
  ).catch((error) => console.warn("[tripConfirmScheduler] notifyTrip (cancelled) failed:", error));
}

// Idempotent by construction: each run re-queries status='collecting' fresh,
// so a trip already flipped to confirmed/cancelled by a prior run (or by
// maybeConfirmTrip's instant path) simply won't be selected again, and
// confirmTripIfCollecting/cancelTripIfCollecting only ever act once per trip
// regardless of how many times a run selects it.
export async function runTripConfirmOrCancelJudgment(now: Date = new Date()): Promise<void> {
  const collectingTrips = await getTripsByStatus("collecting");
  for (const trip of collectingTrips) {
    try {
      await judgeTrip(trip, now);
    } catch (error) {
      console.error(`[tripConfirmScheduler] failed processing trip ${trip.id}:`, error);
    }
  }
}

// In-process scheduler, single replica only. If this service ever scales to
// multiple replicas, replace this with a distributed lock (e.g. a DB-backed
// lock row) or move the judgment to an external cron hitting a dedicated
// endpoint — otherwise every replica would run the same judgment on every
// tick, duplicating notification sends (the DB writes themselves stay safe
// via confirmTripIfCollecting/cancelTripIfCollecting's idempotent guard).
export function startTripConfirmScheduler(): NodeJS.Timeout {
  const timer = setInterval(() => {
    runTripConfirmOrCancelJudgment().catch((error) =>
      console.error("[tripConfirmScheduler] scheduled run failed:", error)
    );
  }, SCHEDULER_INTERVAL_MS);
  timer.unref?.();
  console.log(`[scheduler] trip confirm scheduler started (interval: ${SCHEDULER_INTERVAL_MS / 60000}m)`);
  return timer;
}
