import { haversineMeters } from "./matching/haversine";
import type { BoardingPoint, RallyPointCandidate } from "../drizzle/schema";

// A candidate within this distance of one of the event's existing boarding
// stops is already served — same radius the matching pipeline uses to snap a
// cluster onto a stop (maxSnapDistanceMeters default), so "the same stop"
// means the same thing in both places.
export const SERVED_STOP_RADIUS_METERS = 300;

/**
 * "+1 여기서 출발 원해요" candidates for an event: active rally point
 * candidates that do NOT overlap a boarding stop the event's trips already
 * serve. Pure so the exclusion rule is unit-testable without a DB.
 */
export function filterUnservedCandidates(
  candidates: RallyPointCandidate[],
  boardingPoints: BoardingPoint[],
  radiusMeters: number = SERVED_STOP_RADIUS_METERS
): RallyPointCandidate[] {
  const servedPoints = boardingPoints
    .filter((bp) => bp.lat != null && bp.lng != null)
    .map((bp) => ({ lat: Number(bp.lat), lng: Number(bp.lng) }));

  if (servedPoints.length === 0) return candidates;

  return candidates.filter((candidate) => {
    const pos = { lat: Number(candidate.lat), lng: Number(candidate.lng) };
    return !servedPoints.some((sp) => haversineMeters(pos, sp) <= radiusMeters);
  });
}
