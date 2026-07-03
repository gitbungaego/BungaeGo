import { describe, expect, it } from "vitest";
import { computeGroupKey, groupRequests } from "./grouping";

describe("computeGroupKey", () => {
  it("assigns the same key to two timestamps in the same 30-minute bucket", () => {
    const a = new Date("2026-08-01T10:00:00Z");
    const b = new Date("2026-08-01T10:29:00Z");
    expect(computeGroupKey(1, a, 30)).toBe(computeGroupKey(1, b, 30));
  });

  it("assigns different keys just across a bucket boundary", () => {
    const a = new Date("2026-08-01T10:29:59Z");
    const b = new Date("2026-08-01T10:30:00Z");
    expect(computeGroupKey(1, a, 30)).not.toBe(computeGroupKey(1, b, 30));
  });

  it("includes eventId so different events never share a bucket", () => {
    const t = new Date("2026-08-01T10:00:00Z");
    expect(computeGroupKey(1, t, 30)).not.toBe(computeGroupKey(2, t, 30));
  });
});

describe("groupRequests", () => {
  it("buckets requests by target arrival time", () => {
    const requests = [
      { id: 1, targetArrivalAt: new Date("2026-08-01T10:00:00Z") },
      { id: 2, targetArrivalAt: new Date("2026-08-01T10:10:00Z") },
      { id: 3, targetArrivalAt: new Date("2026-08-01T11:00:00Z") },
    ];
    const groups = groupRequests(1, requests, 30);
    expect(groups.size).toBe(2);
    const sizes = Array.from(groups.values()).map((g) => g.length).sort();
    expect(sizes).toEqual([1, 2]);
  });
});
