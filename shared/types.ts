/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

// Theme trip configuration shape for trips.themeConfig (JSON column).
export type ThemeConfig = {
  feeAmount: { M: number; F: number } | number;
  minM: number;
  minF: number;
  genderCap: { M: number; F: number };
  ageBand: string;
};

// Seat availability snapshot for a trip, produced by ConfirmPolicy
// (server/matching/confirmPolicy.ts). Also the payload shape for the
// future WebSocket seat-status event.
export interface SeatAvailability {
  total: number;
  remaining: number;
  byGroup?: Record<string, { cap: number; remaining: number }>;
}
