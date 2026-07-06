import { describe, expect, it } from "vitest";
import { runMatchingPipeline, type PipelineInput, type PipelineRequest } from "./pipeline";

function tightGroup(
  startId: number,
  center: { lat: number; lng: number },
  count: number,
  targetArrivalAt: Date,
  seatsEach = 1
): PipelineRequest[] {
  const out: PipelineRequest[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: startId + i,
      lat: center.lat + (i - count / 2) * 0.0003,
      lng: center.lng,
      targetArrivalAt,
      seats: seatsEach,
    });
  }
  return out;
}

describe("runMatchingPipeline", () => {
  const params = {
    bucketSizeMinutes: 30,
    epsMeters: 800,
    minPts: 8,
    maxSnapDistanceMeters: 300,
    maxCapacitySeats: 45,
    minCapacitySeats: 15,
    avgSpeedKmh: 30,
    stopDwellMinutes: 3,
    mergeMaxDetourMinutes: 15,
    mergeMaxDetourKm: 10,
  };

  it("clusters requests, builds routes, and tracks failed requests across 2 buckets / 3 geographic clusters", () => {
    const bucketA = new Date("2026-08-01T18:00:00Z");
    const bucketB = new Date("2026-08-01T19:00:00Z"); // clearly separate 30-min bucket

    const clusterA1 = tightGroup(0, { lat: 37.5, lng: 127.0 }, 10, bucketA);
    const clusterA2 = tightGroup(100, { lat: 37.55, lng: 127.08 }, 10, bucketA);
    const clusterB1 = tightGroup(200, { lat: 37.6, lng: 127.15 }, 12, bucketB);

    // A far-flung isolated request that should fail to merge into anything.
    const isolated: PipelineRequest = {
      id: 999,
      lat: 40.0,
      lng: 130.0,
      targetArrivalAt: bucketA,
      seats: 1,
    };

    const requests = [...clusterA1, ...clusterA2, ...clusterB1, isolated];

    const input: PipelineInput = {
      eventId: 1,
      venue: { lat: 37.4, lng: 127.0 },
      requests,
      stopCandidates: [],
      params,
    };

    const output = runMatchingPipeline(input);

    // 3 viable geographic clusters should each produce a route.
    expect(output.routes.length).toBeGreaterThanOrEqual(2);

    // No route should exceed capacity.
    for (const route of output.routes) {
      expect(route.totalSeats).toBeLessThanOrEqual(params.maxCapacitySeats);
    }

    // The isolated far-away request should end up failed (can't merge, can't cluster).
    expect(output.failedRequestIds).toContain(999);

    // Every non-failed request should appear in exactly one cluster.
    const allMemberIds = output.clusters.flatMap((c) => c.memberRequestIds);
    expect(new Set(allMemberIds).size).toBe(requests.length);
  });

  it("fails an over-capacity cluster explicitly, so admin.matching.commit's status !== \"failed\" assignment check never sees a route-less viable cluster", () => {
    const bucketA = new Date("2026-08-01T18:00:00Z");
    // 8 requests (meets minPts) x 6 seats = 48 total, exceeding maxCapacitySeats (45).
    const oversizedGroup = tightGroup(0, { lat: 37.5, lng: 127.0 }, 8, bucketA, 6);

    const input: PipelineInput = {
      eventId: 1,
      venue: { lat: 37.4, lng: 127.0 },
      requests: oversizedGroup,
      stopCandidates: [],
      params,
    };

    const output = runMatchingPipeline(input);

    // No bus was ever built for this cluster.
    expect(output.routes.length).toBe(0);

    // The cluster itself must be "failed", not left "viable" - a "viable"
    // status here would be a contradiction: commit() skips assignment only
    // for status === "failed", so a "viable" cluster with no actual route
    // would get assigned to a bus that was never built.
    expect(output.clusters.length).toBe(1);
    expect(output.clusters[0].status).toBe("failed");

    // And its members must be reported as failed too.
    const memberIds = oversizedGroup.map((r) => r.id);
    for (const id of memberIds) {
      expect(output.failedRequestIds).toContain(id);
    }
  });

  it("is deterministic: the same input run twice produces identical output", () => {
    const bucketA = new Date("2026-08-01T18:00:00Z");
    const bucketB = new Date("2026-08-01T19:00:00Z");

    const clusterA1 = tightGroup(0, { lat: 37.5, lng: 127.0 }, 10, bucketA);
    const clusterA2 = tightGroup(100, { lat: 37.55, lng: 127.08 }, 10, bucketA);
    const clusterB1 = tightGroup(200, { lat: 37.6, lng: 127.15 }, 12, bucketB);
    const isolated: PipelineRequest = {
      id: 999,
      lat: 40.0,
      lng: 130.0,
      targetArrivalAt: bucketA,
      seats: 1,
    };

    const input: PipelineInput = {
      eventId: 1,
      venue: { lat: 37.4, lng: 127.0 },
      requests: [...clusterA1, ...clusterA2, ...clusterB1, isolated],
      stopCandidates: [],
      params,
    };

    const first = runMatchingPipeline(input);
    const second = runMatchingPipeline(input);

    expect(second).toEqual(first);
  });
});
