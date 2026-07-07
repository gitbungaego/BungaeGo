import { dMinusBoundaryUtc, isCreatedAfterOwnD5 } from "@shared/cancellationPolicy";
import {
  cancelTripIfCollecting,
  confirmTripIfCollecting,
  getEventById,
  getReservationsWithPaymentsByTripId,
  getTripsByStatus,
} from "../db";
import { getPolicy } from "../matching/confirmPolicy";
import { cancelReservationsForTrip } from "../payments";
import { notifyTrip } from "../notify/tripMessenger";
import type { Trip } from "../../drizzle/schema";

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

  if (policy.canConfirm(trip, tripReservations)) {
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

  const didCancel = await cancelTripIfCollecting(trip.id, "min_count_not_met");
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
  return timer;
}
