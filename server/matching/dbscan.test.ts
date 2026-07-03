import { describe, expect, it } from "vitest";
import { dbscan } from "./dbscan";

function makeTightGroup(id0: number, center: { lat: number; lng: number }, count: number) {
  // Small deterministic offsets, all well within 100m of center.
  const points = [];
  for (let i = 0; i < count; i++) {
    const offset = (i - count / 2) * 0.0002; // ~22m steps
    points.push({ id: id0 + i, lat: center.lat + offset, lng: center.lng });
  }
  return points;
}

describe("dbscan", () => {
  it("finds two well-separated tight clusters with no noise", () => {
    const groupA = makeTightGroup(0, { lat: 37.5, lng: 127.0 }, 10);
    const groupB = makeTightGroup(100, { lat: 37.6, lng: 127.1 }, 10);
    const result = dbscan([...groupA, ...groupB], { epsMeters: 500, minPts: 5 });

    expect(result.clusters.length).toBe(2);
    expect(result.noise.length).toBe(0);
    const sizes = result.clusters.map((c) => c.length).sort();
    expect(sizes).toEqual([10, 10]);
  });

  it("marks low-density points as noise", () => {
    const scattered = [
      { id: 1, lat: 37.5, lng: 127.0 },
      { id: 2, lat: 37.55, lng: 127.05 },
      { id: 3, lat: 37.6, lng: 127.1 },
    ];
    const result = dbscan(scattered, { epsMeters: 500, minPts: 5 });
    expect(result.clusters.length).toBe(0);
    expect(result.noise.length).toBe(3);
  });

  it("treats a single isolated point as noise", () => {
    const points = [{ id: 1, lat: 37.5, lng: 127.0 }];
    const result = dbscan(points, { epsMeters: 500, minPts: 2 });
    expect(result.clusters.length).toBe(0);
    expect(result.noise).toEqual(points);
  });

  it("assigns a border point (reachable but not itself a core point) to the cluster", () => {
    // Core points tightly packed; one border point just within eps of the core but far from others.
    const core = makeTightGroup(0, { lat: 37.5, lng: 127.0 }, 5);
    const border = { id: 999, lat: 37.5 + 0.0002 * 3, lng: 127.0 }; // within eps of edge core point
    const result = dbscan([...core, border], { epsMeters: 200, minPts: 5 });

    expect(result.clusters.length).toBe(1);
    expect(result.noise.length).toBe(0);
    const memberIds = result.clusters[0].map((p) => p.id).sort((a, b) => a - b);
    expect(memberIds).toContain(999);
  });
});
