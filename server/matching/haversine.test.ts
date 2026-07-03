import { describe, expect, it } from "vitest";
import { haversineMeters } from "./haversine";

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters({ lat: 37.5, lng: 127.0 }, { lat: 37.5, lng: 127.0 })).toBe(0);
  });

  it("approximates ~1.11km for 0.01 degree latitude difference at the equator", () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0.01, lng: 0 });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
  });

  it("is symmetric", () => {
    const a = { lat: 37.55, lng: 126.97 };
    const b = { lat: 37.56, lng: 127.03 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});
