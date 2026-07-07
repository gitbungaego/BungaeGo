import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getActiveStopCandidates: vi.fn(),
    getBusAccessibleRallyPointCandidates: vi.fn(),
  };
});

import * as db from "./db";
import { getMatchingStopCandidates, RALLY_POINT_CANDIDATE_ID_OFFSET } from "./routers";
import type { RallyPointCandidate, StopCandidate } from "../drizzle/schema";

function fakeStop(overrides: Partial<StopCandidate>): StopCandidate {
  return {
    id: 1,
    name: "동탄역",
    address: null,
    lat: "37.20",
    lng: "127.09",
    capacity: null,
    safeForCoach: true,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeRallyPoint(overrides: Partial<RallyPointCandidate>): RallyPointCandidate {
  return {
    id: 1,
    name: "창원종합버스터미널",
    region: "창원",
    lat: "35.2359",
    lng: "128.6366",
    busAccessible: true,
    notes: null,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("getMatchingStopCandidates", () => {
  afterEach(() => {
    vi.mocked(db.getActiveStopCandidates).mockReset();
    vi.mocked(db.getBusAccessibleRallyPointCandidates).mockReset();
  });

  it("combines stopCandidates and busAccessible rally points with disjoint id spaces", async () => {
    vi.mocked(db.getActiveStopCandidates).mockResolvedValueOnce([fakeStop({ id: 1 }), fakeStop({ id: 2 })]);
    vi.mocked(db.getBusAccessibleRallyPointCandidates).mockResolvedValueOnce([
      fakeRallyPoint({ id: 1 }), // same raw id as a stopCandidate - must not collide
      fakeRallyPoint({ id: 2, name: "마산시외버스터미널" }),
    ]);

    const combined = await getMatchingStopCandidates();

    expect(combined).toHaveLength(4);
    const ids = combined.map((c) => c.id);
    expect(new Set(ids).size).toBe(4); // no collisions

    const rallyEntries = combined.filter((c) => c.id >= RALLY_POINT_CANDIDATE_ID_OFFSET);
    expect(rallyEntries).toHaveLength(2);
    expect(rallyEntries.map((c) => c.id)).toEqual([
      RALLY_POINT_CANDIDATE_ID_OFFSET + 1,
      RALLY_POINT_CANDIDATE_ID_OFFSET + 2,
    ]);
  });

  it("only queries busAccessible rally points, not all active ones", async () => {
    vi.mocked(db.getActiveStopCandidates).mockResolvedValueOnce([]);
    vi.mocked(db.getBusAccessibleRallyPointCandidates).mockResolvedValueOnce([]);

    await getMatchingStopCandidates();

    expect(db.getBusAccessibleRallyPointCandidates).toHaveBeenCalled();
  });
});
