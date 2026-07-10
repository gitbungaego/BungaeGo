import { dMinusBoundaryUtc } from "@shared/cancellationPolicy";
import { isAutoMatchingEnabled } from "../_core/env";
import { notifyOwner } from "../_core/notification";
import { freezeEventIfUnfrozen, getUnfrozenAutoMatchEvents } from "../db";
import { executeMatching } from "../matching/executeMatching";
import { refundUnmatchedRideRequests } from "../payments";
import type { Event } from "../../drizzle/schema";

const D7_DAYS_BEFORE = 7;
export const MATCHING_SCHEDULER_INTERVAL_MS = 10 * 60 * 1000;

// The auto-freeze owner (creatorId) for scheduler-created trips. No human
// admin acted, so trips are attributed to the system account (id 0), matching
// how the D-5 confirm scheduler acts without a user.
const SYSTEM_CREATOR_ID = 0;

function hasReachedD7(event: Event, now: Date): boolean {
  return now.getTime() >= dMinusBoundaryUtc(event.eventDate, D7_DAYS_BEFORE).getTime();
}

/**
 * Auto-freeze + auto-match one event. The freeze mark is claimed FIRST as a
 * preemption lock (freezeEventIfUnfrozen is a conditional UPDATE), so a second
 * tick — or an admin racing the scheduler — can never double-process. If the
 * claim is lost, someone else owns it and we return. If matching then fails,
 * the event stays frozen (the claim holds) and the failure is surfaced so an
 * admin can resume with a manual commit (which is allowed while frozen as long
 * as no pipeline trips exist yet).
 */
async function autoFreezeEvent(event: Event): Promise<void> {
  const claimed = await freezeEventIfUnfrozen(event.id, "auto");
  if (!claimed) {
    // Lost the race (concurrent tick or admin froze it first).
    return;
  }

  let matchingSucceeded = false;
  try {
    const result = await executeMatching({
      eventId: event.id,
      creatorId: SYSTEM_CREATOR_ID,
    });
    matchingSucceeded = true;

    // Refund + fail everyone the pipeline couldn't place (noise / oversized /
    // unmerged), same handling as the manual freeze.
    const { refundedCount, refundFailures } = await refundUnmatchedRideRequests(
      event.id,
      "자동 배차 미매칭 환불"
    );

    console.log(
      `[matching] auto-froze event ${event.id}: ${result.createdTripCount} trips, ${result.matchedRequestCount} matched, ${refundedCount} refunded${refundFailures > 0 ? `, ${refundFailures} refund-failed` : ""}`
    );
    await notifyOwner({
      title: `[번개GO] ${event.title} 자동 배차 완료`,
      content: `셔틀 ${result.createdTripCount}개 생성, ${result.matchedRequestCount}건 배정, 미매칭 ${refundedCount}건 환불.${refundFailures > 0 ? ` (환불 실패 ${refundFailures}건 - 수동 처리 필요)` : ""}`,
    }).catch(() => false);
  } catch (error) {
    console.error(`[matching] auto-match failed for event ${event.id} (kept frozen for manual resume):`, error);
    if (!matchingSucceeded) {
      await notifyOwner({
        title: `[번개GO] ${event.title} 자동 배차 실패 - 수동 처리 필요`,
        content: `자동 동결은 되었으나 매칭 실행에 실패했습니다. 관리자 페이지에서 수동 확정(commit)으로 이어가 주세요. (eventId ${event.id})`,
      }).catch(() => false);
    }
  }
}

/**
 * Idempotent by construction: only unfrozen auto-match events past their D-7
 * boundary are selected, and freezeEventIfUnfrozen atomically claims each one,
 * so a tick that reselects an event already being processed simply loses the
 * claim. Per-event try-catch keeps one failure from blocking the rest.
 */
export async function runMatchingFreezeJudgment(now: Date = new Date()): Promise<void> {
  const dryRun = !isAutoMatchingEnabled();
  const candidates = await getUnfrozenAutoMatchEvents();

  for (const event of candidates) {
    if (!hasReachedD7(event, now)) continue;
    try {
      if (dryRun) {
        console.log(`[matching] would freeze event ${event.id} (dry-run)`);
        continue;
      }
      await autoFreezeEvent(event);
    } catch (error) {
      console.error(`[matchingFreezeScheduler] failed processing event ${event.id}:`, error);
    }
  }
}

// In-process scheduler, single replica only — same caveat as the D-5 confirm
// scheduler. The freeze claim (conditional UPDATE) is the safety net if this
// ever runs on multiple replicas: only one claim wins per event.
export function startMatchingFreezeScheduler(): NodeJS.Timeout {
  const timer = setInterval(() => {
    runMatchingFreezeJudgment().catch((error) =>
      console.error("[matchingFreezeScheduler] scheduled run failed:", error)
    );
  }, MATCHING_SCHEDULER_INTERVAL_MS);
  timer.unref?.();
  console.log(`[scheduler] matching freeze scheduler started (interval: ${MATCHING_SCHEDULER_INTERVAL_MS / 60000}m)`);
  return timer;
}
