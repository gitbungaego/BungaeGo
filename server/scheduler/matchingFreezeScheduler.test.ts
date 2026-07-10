import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getUnfrozenAutoMatchEvents: vi.fn(),
  freezeEventIfUnfrozen: vi.fn(),
}));

vi.mock("../matching/executeMatching", () => ({
  executeMatching: vi.fn(),
}));

vi.mock("../payments", () => ({
  refundUnmatchedRideRequests: vi.fn(),
}));

vi.mock("../_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

import * as db from "../db";
import { executeMatching } from "../matching/executeMatching";
import { refundUnmatchedRideRequests } from "../payments";
import { runMatchingFreezeJudgment } from "./matchingFreezeScheduler";
import type { Event } from "../../drizzle/schema";

// eventDate = 2026-08-20 20:00 KST = 2026-08-20 11:00 UTC.
// D-7 00:00 KST boundary = 2026-08-12 15:00 UTC.
const EVENT_DATE = new Date("2026-08-20T11:00:00.000Z");
const D7_BOUNDARY = new Date("2026-08-12T15:00:00.000Z");
const JUST_BEFORE_D7 = new Date(D7_BOUNDARY.getTime() - 60 * 1000);
const AT_D7 = D7_BOUNDARY;

function fakeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 1,
    title: "Auto Match Event",
    category: "concert",
    eventDate: EVENT_DATE,
    venue: "Venue",
    address: null,
    lat: "37.5",
    lng: "127.0",
    imageUrl: null,
    description: null,
    status: "active",
    creatorId: null,
    organizerName: null,
    autoMatchEnabled: true,
    autoMatchPricePerSeat: 20000,
    matchingFrozenAt: null,
    matchingFrozenBy: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(executeMatching).mockResolvedValue({
    createdTripCount: 2,
    matchedRequestCount: 5,
    createdTripIds: [101, 102],
    output: { clusters: [], routes: [], failedRequestIds: [] },
  });
  vi.mocked(refundUnmatchedRideRequests).mockResolvedValue({ refundedCount: 1, refundFailures: 0 });
  vi.mocked(db.freezeEventIfUnfrozen).mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(db.getUnfrozenAutoMatchEvents).mockReset();
  vi.mocked(db.freezeEventIfUnfrozen).mockReset();
  vi.mocked(executeMatching).mockReset();
  vi.mocked(refundUnmatchedRideRequests).mockReset();
});

describe("runMatchingFreezeJudgment - D-7 boundary (KST)", () => {
  it("does NOT process an event before its D-7 00:00 KST boundary", async () => {
    vi.stubEnv("AUTO_MATCHING_ENABLED", "true");
    vi.mocked(db.getUnfrozenAutoMatchEvents).mockResolvedValue([fakeEvent()]);

    await runMatchingFreezeJudgment(JUST_BEFORE_D7);

    expect(db.freezeEventIfUnfrozen).not.toHaveBeenCalled();
    expect(executeMatching).not.toHaveBeenCalled();
  });

  it("processes an event exactly at its D-7 boundary", async () => {
    vi.stubEnv("AUTO_MATCHING_ENABLED", "true");
    vi.mocked(db.getUnfrozenAutoMatchEvents).mockResolvedValue([fakeEvent()]);

    await runMatchingFreezeJudgment(AT_D7);

    expect(db.freezeEventIfUnfrozen).toHaveBeenCalledWith(1, "auto");
    expect(executeMatching).toHaveBeenCalledWith(expect.objectContaining({ eventId: 1 }));
    expect(refundUnmatchedRideRequests).toHaveBeenCalledWith(1, expect.any(String));
  });
});

describe("runMatchingFreezeJudgment - dry-run (AUTO_MATCHING_ENABLED off)", () => {
  it("logs but does not freeze or match when the flag is unset", async () => {
    // No AUTO_MATCHING_ENABLED stub → dry-run.
    vi.mocked(db.getUnfrozenAutoMatchEvents).mockResolvedValue([fakeEvent()]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runMatchingFreezeJudgment(AT_D7);

    expect(db.freezeEventIfUnfrozen).not.toHaveBeenCalled();
    expect(executeMatching).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("would freeze event 1 (dry-run)"));
    logSpy.mockRestore();
  });
});

describe("runMatchingFreezeJudgment - freeze preemption idempotency", () => {
  it("skips matching when the freeze claim is lost (already being processed)", async () => {
    vi.stubEnv("AUTO_MATCHING_ENABLED", "true");
    vi.mocked(db.getUnfrozenAutoMatchEvents).mockResolvedValue([fakeEvent()]);
    vi.mocked(db.freezeEventIfUnfrozen).mockResolvedValue(false); // lost the race

    await runMatchingFreezeJudgment(AT_D7);

    expect(db.freezeEventIfUnfrozen).toHaveBeenCalledTimes(1);
    expect(executeMatching).not.toHaveBeenCalled();
    expect(refundUnmatchedRideRequests).not.toHaveBeenCalled();
  });
});

describe("runMatchingFreezeJudgment - failure isolation", () => {
  it("keeps the event frozen and does not refund when matching throws", async () => {
    vi.stubEnv("AUTO_MATCHING_ENABLED", "true");
    vi.mocked(db.getUnfrozenAutoMatchEvents).mockResolvedValue([fakeEvent()]);
    vi.mocked(executeMatching).mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runMatchingFreezeJudgment(AT_D7);

    expect(db.freezeEventIfUnfrozen).toHaveBeenCalledWith(1, "auto"); // freeze held
    expect(refundUnmatchedRideRequests).not.toHaveBeenCalled(); // matching failed before refund
  });

  it("processes other events when one throws", async () => {
    vi.stubEnv("AUTO_MATCHING_ENABLED", "true");
    vi.mocked(db.getUnfrozenAutoMatchEvents).mockResolvedValue([
      fakeEvent({ id: 1 }),
      fakeEvent({ id: 2 }),
    ]);
    vi.mocked(db.freezeEventIfUnfrozen).mockImplementation(async (eventId: number) => {
      if (eventId === 1) throw new Error("db down for event 1");
      return true;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runMatchingFreezeJudgment(AT_D7);

    // Event 2 still processed despite event 1 throwing.
    expect(executeMatching).toHaveBeenCalledWith(expect.objectContaining({ eventId: 2 }));
    expect(executeMatching).toHaveBeenCalledTimes(1);
  });

  it("ignores events not yet at D-7 while processing those that are", async () => {
    vi.stubEnv("AUTO_MATCHING_ENABLED", "true");
    vi.mocked(db.getUnfrozenAutoMatchEvents).mockResolvedValue([
      fakeEvent({ id: 1, eventDate: EVENT_DATE }), // at D-7
      fakeEvent({ id: 2, eventDate: new Date("2026-09-20T11:00:00.000Z") }), // far future
    ]);

    await runMatchingFreezeJudgment(AT_D7);

    expect(db.freezeEventIfUnfrozen).toHaveBeenCalledTimes(1);
    expect(db.freezeEventIfUnfrozen).toHaveBeenCalledWith(1, "auto");
  });
});
