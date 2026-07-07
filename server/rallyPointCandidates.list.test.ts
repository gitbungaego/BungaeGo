import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, getActiveRallyPointCandidates: vi.fn() };
});

import * as db from "./db";
import { appRouter } from "./routers";
import type { RallyPointCandidate } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

function fakeCandidate(overrides: Partial<RallyPointCandidate>): RallyPointCandidate {
  return {
    id: 1,
    name: "창원종합버스터미널",
    region: "창원",
    lat: "35.2359",
    lng: "128.6366",
    busAccessible: true,
    notes: "터미널",
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

describe("rallyPointCandidates.list", () => {
  afterEach(() => {
    vi.mocked(db.getActiveRallyPointCandidates).mockReset();
  });

  it("returns active candidates, unauthenticated", async () => {
    const candidates = [fakeCandidate({ id: 1 }), fakeCandidate({ id: 2, busAccessible: false })];
    vi.mocked(db.getActiveRallyPointCandidates).mockResolvedValueOnce(candidates);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.rallyPointCandidates.list();

    expect(result).toEqual(candidates);
  });
});
