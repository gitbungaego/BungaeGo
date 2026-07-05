import { getReservationsWithPaymentsByTripId, type ReservationWithPayment } from "./db";

export type ParticipantFilter = "all" | "checkedIn" | "notCheckedIn" | number[];

export interface TripParticipant {
  userId: number;
  reservationId: number;
  seats: number;
  passengerName: string | null;
  passengerPhone: string | null;
  passengerEmail: string | null;
}

function toParticipant(r: ReservationWithPayment): TripParticipant {
  return {
    userId: r.userId,
    reservationId: r.id,
    seats: r.seats,
    passengerName: r.passengerName,
    passengerPhone: r.passengerPhone,
    passengerEmail: r.passengerEmail,
  };
}

// Split out from the DB fetch so the filtering rules are unit-testable without a DB connection.
export function filterParticipants(
  reservations: ReservationWithPayment[],
  filter: ParticipantFilter
): TripParticipant[] {
  const validReservations = reservations.filter((r) => r.status === "paid");

  if (Array.isArray(filter)) {
    const ids = new Set(filter);
    return validReservations.filter((r) => ids.has(r.userId)).map(toParticipant);
  }

  if (filter === "checkedIn" || filter === "notCheckedIn") {
    // No check-in/boarding-scan tracking exists anywhere in this codebase yet
    // (no column, no scan flow) — throw rather than silently return the wrong set.
    throw new Error(`getTripParticipants: "${filter}" requires check-in tracking, which doesn't exist yet`);
  }

  return validReservations.map(toParticipant);
}

// Reusable trip roster lookup (also intended for future trip chat / grouping features).
export async function getTripParticipants(
  tripId: number,
  filter: ParticipantFilter = "all"
): Promise<TripParticipant[]> {
  const reservations = await getReservationsWithPaymentsByTripId(tripId);
  return filterParticipants(reservations, filter);
}
