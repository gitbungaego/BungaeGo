// Cancellation/refund policy (핸디버스 방식). All D-N boundaries are computed
// against Asia/Seoul (KST) wall-clock dates regardless of server timezone —
// the server runs in UTC, so every boundary here is derived by shifting to
// the KST wall-clock, snapping to that day's midnight, and shifting back.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const ONE_HOUR_MS = 60 * 60 * 1000;

// A UTC instant representing the same wall-clock fields KST would show —
// only ever read via getUTC*, never compared directly against a real instant.
function toKstWallClock(date: Date): Date {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

// The UTC instant of 00:00 KST on the calendar day `date` falls on in KST.
function kstMidnightUtc(date: Date): Date {
  const kst = toKstWallClock(date);
  const midnightKstWallClock = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  return new Date(midnightKstWallClock - KST_OFFSET_MS);
}

// D-N 00:00 (KST) boundary for a given departure instant, e.g.
// dMinusBoundaryUtc(departureAt, 5) is "D-5 00:00 KST" as a UTC instant.
export function dMinusBoundaryUtc(departureAt: Date, daysBefore: number): Date {
  const departureDayMidnightUtc = kstMidnightUtc(departureAt);
  return new Date(departureDayMidnightUtc.getTime() - daysBefore * 24 * 60 * 60 * 1000);
}

export type CancellationDecision =
  | { allowed: true; feeRate: 0 | 0.25 | 0.5 }
  | { allowed: false; reason: string };

// Tiered cancellation fee schedule:
//   - within 1hr of reservation creation: always free (overrides everything below)
//   - ~ D-8 23:59 KST: free
//   - D-7 00:00~23:59 KST: 25% fee
//   - D-6 00:00~23:59 KST: 50% fee
//   - D-5 00:00 KST onward: cancellation not allowed
export function evaluateCancellation(
  departureAt: Date,
  reservationCreatedAt: Date,
  now: Date
): CancellationDecision {
  if (now.getTime() - reservationCreatedAt.getTime() <= ONE_HOUR_MS) {
    return { allowed: true, feeRate: 0 };
  }

  const d7 = dMinusBoundaryUtc(departureAt, 7);
  const d6 = dMinusBoundaryUtc(departureAt, 6);
  const d5 = dMinusBoundaryUtc(departureAt, 5);

  if (now.getTime() < d7.getTime()) return { allowed: true, feeRate: 0 };
  if (now.getTime() < d6.getTime()) return { allowed: true, feeRate: 0.25 };
  if (now.getTime() < d5.getTime()) return { allowed: true, feeRate: 0.5 };
  return { allowed: false, reason: "출발일이 임박해 취소할 수 없습니다 (D-5 이후에는 취소가 불가합니다)." };
}

// Trips created after their own D-5 (KST) boundary have no future D-5
// judgment moment for the confirm-or-cancel scheduler to act on — these are
// "급하게 만든 셔틀" that keep the legacy instant-confirm-on-minCount behavior
// for their entire lifetime instead.
export function isCreatedAfterOwnD5(trip: { departureAt: Date; createdAt: Date }): boolean {
  return trip.createdAt.getTime() >= dMinusBoundaryUtc(trip.departureAt, 5).getTime();
}
