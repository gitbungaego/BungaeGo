import type { Event } from "../../drizzle/schema";
import {
  getActiveStopCandidates,
  getBusAccessibleRallyPointCandidates,
  getEventById,
  getLatestPaymentByRideRequestId,
  getPendingRideRequestsByEventId,
  persistMatchingCommit,
  type PersistMatchingHooks,
} from "../db";
import { runMatchingPipeline, type PipelineOutput } from "./pipeline";
import { DEFAULT_PIPELINE_PARAMS, type PipelineParamsInput, resolvePipelineParams } from "./matchingParams";
import { applyRideRequestDifferenceRefund } from "../payments";
import { maybeConfirmTrip } from "../reservationFlow";
import { notifyTrip } from "../notify/tripMessenger";

// The two cluster-snap candidate tables have independent id sequences, so
// rally-point ids are offset well out of stopCandidates' range before being
// handed to the pipeline — assignedStopId has no FK, it's an opaque lookup key.
export const RALLY_POINT_CANDIDATE_ID_OFFSET = 1_000_000;

export async function getMatchingStopCandidates(): Promise<{ id: number; lat: number; lng: number; name: string }[]> {
  const [stops, rallyPoints] = await Promise.all([
    getActiveStopCandidates(),
    getBusAccessibleRallyPointCandidates(),
  ]);
  return [
    ...stops.map((s) => ({ id: s.id, lat: Number(s.lat), lng: Number(s.lng), name: s.name })),
    ...rallyPoints.map((r) => ({
      id: RALLY_POINT_CANDIDATE_ID_OFFSET + r.id,
      lat: Number(r.lat),
      lng: Number(r.lng),
      name: r.name,
    })),
  ];
}

export interface ExecuteMatchingOptions {
  eventId: number;
  creatorId: number;
  params?: PipelineParamsInput;
  // Trip's final per-seat price. Must be <= the event cap. Omit to charge the
  // cap (difference refund of 0).
  finalPricePerSeat?: number;
  hooks?: PersistMatchingHooks;
}

export interface ExecuteMatchingResult {
  createdTripCount: number;
  matchedRequestCount: number;
  createdTripIds: number[];
  // The raw pipeline output, so the admin UI can render the same cluster/route
  // preview it shows before committing.
  output: PipelineOutput;
}

export class MatchingError extends Error {}

/**
 * The full "commit" of a matching run for one event, shared by the admin
 * manual commit and the D-7 auto-freeze scheduler:
 *   1. load pending requests + stop candidates
 *   2. run the pure pipeline
 *   3. persist the entire result in ONE DB transaction (persistMatchingCommit)
 *   4. after commit: D-5 instant-confirm check, Toss difference refunds, and
 *      matched-rider notifications
 *
 * The freeze mark is the caller's responsibility (set before calling this in
 * the scheduler, checked before calling it in the router). External side
 * effects run only after the transaction commits, so a rolled-back matching
 * never sends a notification or refunds a cap difference.
 */
export async function executeMatching(opts: ExecuteMatchingOptions): Promise<ExecuteMatchingResult> {
  const event = await getEventById(opts.eventId);
  if (!event) throw new MatchingError("이벤트를 찾을 수 없습니다.");
  if (!event.lat || !event.lng) {
    throw new MatchingError("이벤트에 좌표(장소)가 설정되어 있지 않습니다.");
  }

  const capPricePerSeat = event.autoMatchPricePerSeat ?? 0;
  if (opts.finalPricePerSeat !== undefined && opts.finalPricePerSeat > capPricePerSeat) {
    throw new MatchingError(`최종 가격은 상한가(${capPricePerSeat}원) 이하여야 합니다.`);
  }
  const finalPricePerSeat = opts.finalPricePerSeat ?? capPricePerSeat;
  const params = opts.params ? resolvePipelineParams(opts.params) : DEFAULT_PIPELINE_PARAMS;

  const [pendingRequests, stopCandidates] = await Promise.all([
    getPendingRideRequestsByEventId(opts.eventId),
    getMatchingStopCandidates(),
  ]);
  const requestById = new Map(pendingRequests.map((r) => [r.id, r]));
  const stopNameById = new Map(stopCandidates.map((s) => [s.id, s.name]));

  const output = runMatchingPipeline({
    eventId: opts.eventId,
    venue: { lat: Number(event.lat), lng: Number(event.lng) },
    requests: pendingRequests.map((r) => ({
      id: r.id,
      lat: Number(r.originLat),
      lng: Number(r.originLng),
      targetArrivalAt: r.targetArrivalAt,
      seats: r.seats,
    })),
    stopCandidates,
    params,
  });

  // Paid Toss prepayments for the requests being matched, so the persist step
  // can link them and the post-commit step can refund the cap difference.
  const tossPayments = new Map<number, NonNullable<Awaited<ReturnType<typeof getLatestPaymentByRideRequestId>>>>();
  await Promise.all(
    pendingRequests.map(async (r) => {
      const payment = await getLatestPaymentByRideRequestId(r.id);
      if (payment && payment.method === "toss" && payment.status === "paid") {
        tossPayments.set(r.id, payment);
      }
    })
  );

  const persisted = await persistMatchingCommit(
    {
      eventId: opts.eventId,
      creatorId: opts.creatorId,
      minCount: params.minCapacitySeats,
      maxCount: params.maxCapacitySeats,
      finalPricePerSeat,
      output,
      stopNameById,
      requestById,
      tossPaymentByRequestId: tossPayments,
    },
    opts.hooks
  );

  // ── Post-commit side effects (never inside the transaction) ──
  for (const tripId of persisted.createdTripIds) {
    // No-op for trips created well before their own D-5 boundary (the normal
    // D-7 case); the D-5 scheduler makes the confirm/cancel call two days later.
    await maybeConfirmTrip(tripId).catch((error) =>
      console.warn(`[executeMatching] maybeConfirmTrip failed for trip ${tripId}:`, error)
    );
  }

  for (const job of persisted.differenceRefunds) {
    try {
      await applyRideRequestDifferenceRefund(job.payment, {
        userId: job.userId,
        requestId: job.requestId,
        seats: job.seats,
        capPricePerSeat,
        finalPricePerSeat,
      });
    } catch (error) {
      console.error(
        `[executeMatching] difference refund failed for request ${job.requestId} (payment ${job.payment.id}):`,
        error
      );
      // Non-fatal: matching is committed. Surface for manual handling.
      notifyMatchingOwnerRefundFailure(event, job.requestId, job.payment.id, capPricePerSeat, finalPricePerSeat);
    }
  }

  for (const note of persisted.notifications) {
    await notifyTrip(
      note.tripId,
      "reservationConfirmed",
      { passengerName: note.passengerName, seats: note.seats, departureAt: note.departureAt },
      [note.userId]
    ).catch((error) => console.warn("[executeMatching] notifyTrip failed:", error));
  }

  return {
    createdTripCount: persisted.createdTripCount,
    matchedRequestCount: persisted.matchedRequestCount,
    createdTripIds: persisted.createdTripIds,
    output,
  };
}

// Deferred import to avoid a module cycle (notifyOwner pulls in the notification
// core which is unrelated to matching).
function notifyMatchingOwnerRefundFailure(
  event: Event,
  requestId: number,
  paymentId: number,
  capPricePerSeat: number,
  finalPricePerSeat: number
): void {
  import("../_core/notification")
    .then(({ notifyOwner }) =>
      notifyOwner({
        title: "[번개GO] 차액 환불 실패 - 수동 처리 필요",
        content: `${event.title} / 신청 #${requestId} / payment #${paymentId}: 상한가 ${capPricePerSeat}원 → 확정가 ${finalPricePerSeat}원 차액 환불에 실패했습니다.`,
      })
    )
    .catch(() => false);
}
