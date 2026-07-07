import { describe, expect, it } from "vitest";
import { dMinusBoundaryUtc, evaluateCancellation, isCreatedAfterOwnD5, ONE_HOUR_MS } from "./cancellationPolicy";

// departureAt = 2026-08-20 20:00 KST = 2026-08-20 11:00 UTC.
// D-5 00:00 KST = 2026-08-15 00:00 KST = 2026-08-14 15:00 UTC.
const DEPARTURE_AT = new Date("2026-08-20T11:00:00.000Z");
const RESERVED_LONG_AGO = new Date("2026-07-01T00:00:00.000Z"); // outside the 1hr grace window for every "now" used below

describe("dMinusBoundaryUtc", () => {
  it("computes the D-5 00:00 KST boundary as a UTC instant", () => {
    expect(dMinusBoundaryUtc(DEPARTURE_AT, 5)).toEqual(new Date("2026-08-14T15:00:00.000Z"));
  });

  it("computes the D-7 00:00 KST boundary as a UTC instant", () => {
    expect(dMinusBoundaryUtc(DEPARTURE_AT, 7)).toEqual(new Date("2026-08-12T15:00:00.000Z"));
  });
});

describe("evaluateCancellation - tiered fee boundaries", () => {
  it("is free at D-8 23:59:59 KST (just before the D-7 boundary)", () => {
    // D-7 00:00 KST = 2026-08-12T15:00:00Z, so one second before is D-8 23:59:59 KST.
    const now = new Date("2026-08-12T14:59:59.000Z");
    const decision = evaluateCancellation(DEPARTURE_AT, RESERVED_LONG_AGO, now);
    expect(decision).toEqual({ allowed: true, feeRate: 0 });
  });

  it("charges 25% fee exactly at D-7 00:00 KST", () => {
    const now = new Date("2026-08-12T15:00:00.000Z");
    const decision = evaluateCancellation(DEPARTURE_AT, RESERVED_LONG_AGO, now);
    expect(decision).toEqual({ allowed: true, feeRate: 0.25 });
  });

  it("still charges 25% fee at D-6 23:59:59 KST (just before the D-6 boundary)", () => {
    // D-6 00:00 KST = 2026-08-13T15:00:00Z
    const now = new Date("2026-08-13T14:59:59.000Z");
    const decision = evaluateCancellation(DEPARTURE_AT, RESERVED_LONG_AGO, now);
    expect(decision).toEqual({ allowed: true, feeRate: 0.25 });
  });

  it("charges 50% fee exactly at D-6 00:00 KST", () => {
    const now = new Date("2026-08-13T15:00:00.000Z");
    const decision = evaluateCancellation(DEPARTURE_AT, RESERVED_LONG_AGO, now);
    expect(decision).toEqual({ allowed: true, feeRate: 0.5 });
  });

  it("still charges 50% fee at D-5 00:00 KST minus 1 second", () => {
    // D-5 00:00 KST = 2026-08-14T15:00:00Z
    const now = new Date("2026-08-14T14:59:59.000Z");
    const decision = evaluateCancellation(DEPARTURE_AT, RESERVED_LONG_AGO, now);
    expect(decision).toEqual({ allowed: true, feeRate: 0.5 });
  });

  it("forbids cancellation exactly at D-5 00:00 KST", () => {
    const now = new Date("2026-08-14T15:00:00.000Z");
    const decision = evaluateCancellation(DEPARTURE_AT, RESERVED_LONG_AGO, now);
    expect(decision.allowed).toBe(false);
  });

  it("forbids cancellation well after D-5", () => {
    const now = new Date("2026-08-19T00:00:00.000Z");
    const decision = evaluateCancellation(DEPARTURE_AT, RESERVED_LONG_AGO, now);
    expect(decision.allowed).toBe(false);
  });
});

describe("evaluateCancellation - 1hr creation grace overrides everything", () => {
  it("is free 59 minutes after reservation creation, even inside the D-5 forbidden window", () => {
    const reservedAt = new Date("2026-08-19T00:00:00.000Z"); // well past D-5, normally forbidden
    const now = new Date(reservedAt.getTime() + 59 * 60 * 1000);
    const decision = evaluateCancellation(DEPARTURE_AT, reservedAt, now);
    expect(decision).toEqual({ allowed: true, feeRate: 0 });
  });

  it("is free exactly at the 1hr mark", () => {
    const reservedAt = new Date("2026-08-19T00:00:00.000Z");
    const now = new Date(reservedAt.getTime() + ONE_HOUR_MS);
    const decision = evaluateCancellation(DEPARTURE_AT, reservedAt, now);
    expect(decision).toEqual({ allowed: true, feeRate: 0 });
  });

  it("no longer gets the grace 61 minutes after reservation creation", () => {
    const reservedAt = new Date("2026-08-19T00:00:00.000Z"); // well past D-5
    const now = new Date(reservedAt.getTime() + 61 * 60 * 1000);
    const decision = evaluateCancellation(DEPARTURE_AT, reservedAt, now);
    expect(decision.allowed).toBe(false);
  });
});

describe("evaluateCancellation - KST/UTC day-boundary mismatch", () => {
  it("treats a time that is 'yesterday' in UTC but 'today' in KST correctly", () => {
    // departureAt = 2026-09-01 00:30 KST = 2026-08-31 15:30 UTC.
    // Its D-7 00:00 KST boundary = 2026-08-25 00:00 KST = 2026-08-24 15:00 UTC.
    const departureAt = new Date("2026-08-31T15:30:00.000Z");
    // now = 2026-08-24 23:00 UTC = 2026-08-25 08:00 KST -> already past the KST D-7
    // boundary even though, in raw UTC terms, it looks like it's still "D-7's day".
    const now = new Date("2026-08-24T23:00:00.000Z");
    const decision = evaluateCancellation(departureAt, RESERVED_LONG_AGO, now);
    expect(decision).toEqual({ allowed: true, feeRate: 0.25 });
  });

  it("does not yet apply the fee for a UTC instant that is still before the KST D-7 boundary", () => {
    const departureAt = new Date("2026-08-31T15:30:00.000Z");
    // now = 2026-08-24T14:59:59Z = 2026-08-24 23:59:59 KST -> still D-8 in KST.
    const now = new Date("2026-08-24T14:59:59.000Z");
    const decision = evaluateCancellation(departureAt, RESERVED_LONG_AGO, now);
    expect(decision).toEqual({ allowed: true, feeRate: 0 });
  });
});

describe("isCreatedAfterOwnD5", () => {
  it("is false for a trip created well before its own D-5 boundary", () => {
    const trip = { departureAt: DEPARTURE_AT, createdAt: new Date("2026-07-01T00:00:00.000Z") };
    expect(isCreatedAfterOwnD5(trip)).toBe(false);
  });

  it("is true for a trip created exactly at its own D-5 boundary", () => {
    const trip = { departureAt: DEPARTURE_AT, createdAt: dMinusBoundaryUtc(DEPARTURE_AT, 5) };
    expect(isCreatedAfterOwnD5(trip)).toBe(true);
  });

  it("is true for a trip created after its own D-5 boundary (rush-created shuttle)", () => {
    const trip = { departureAt: DEPARTURE_AT, createdAt: new Date("2026-08-18T00:00:00.000Z") };
    expect(isCreatedAfterOwnD5(trip)).toBe(true);
  });
});
