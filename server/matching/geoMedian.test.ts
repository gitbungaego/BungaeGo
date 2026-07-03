import { describe, expect, it } from "vitest";
import { snapToNearestStop, weiszfeldMedian } from "./geoMedian";
import { haversineMeters } from "./haversine";

describe("weiszfeldMedian", () => {
  it("converges near the centroid for a symmetric square of points", () => {
    const center = { lat: 37.5, lng: 127.0 };
    const d = 0.001; // ~111m
    const points = [
      { lat: center.lat + d, lng: center.lng + d },
      { lat: center.lat + d, lng: center.lng - d },
      { lat: center.lat - d, lng: center.lng + d },
      { lat: center.lat - d, lng: center.lng - d },
    ];
    const median = weiszfeldMedian(points, { tolerance: 1 });
    expect(haversineMeters(median, center)).toBeLessThan(5);
  });

  it("returns the single point when only one is given", () => {
    const p = { lat: 37.55, lng: 127.05 };
    expect(weiszfeldMedian([p])).toEqual(p);
  });

  it("converges within a small iteration bound", () => {
    const points = [
      { lat: 37.5, lng: 127.0 },
      { lat: 37.501, lng: 127.001 },
      { lat: 37.499, lng: 126.999 },
    ];
    const median = weiszfeldMedian(points, { maxIterations: 50, tolerance: 1 });
    expect(median.lat).toBeGreaterThan(37.49);
    expect(median.lat).toBeLessThan(37.51);
  });
});

describe("snapToNearestStop", () => {
  const candidates = [
    { id: 1, lat: 37.5, lng: 127.0 },
    { id: 2, lat: 37.6, lng: 127.1 },
  ];

  it("snaps to the nearest candidate within range", () => {
    const result = snapToNearestStop({ lat: 37.5001, lng: 127.0001 }, candidates, 300);
    expect(result?.stop.id).toBe(1);
  });

  it("returns null when nothing is within range", () => {
    const result = snapToNearestStop({ lat: 38.5, lng: 128.0 }, candidates, 300);
    expect(result).toBeNull();
  });
});
