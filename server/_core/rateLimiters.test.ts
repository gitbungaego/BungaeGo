import { describe, expect, it } from "vitest";
import { isWriteMutationRequest } from "./rateLimiters";

describe("isWriteMutationRequest", () => {
  it("matches a standalone write-mutation procedure path", () => {
    expect(isWriteMutationRequest("/reservations.create")).toBe(true);
    expect(isWriteMutationRequest("/events.create")).toBe(true);
    expect(isWriteMutationRequest("/rideRequests.create")).toBe(true);
  });

  it("matches when batched alongside other procedures", () => {
    expect(isWriteMutationRequest("/auth.me,reservations.create")).toBe(true);
  });

  it("does not match unrelated procedures, including similarly-named queries", () => {
    expect(isWriteMutationRequest("/auth.me")).toBe(false);
    expect(isWriteMutationRequest("/reservations.myList")).toBe(false);
    expect(isWriteMutationRequest("/reservations.cancel")).toBe(false);
    expect(isWriteMutationRequest("/events.list")).toBe(false);
  });
});
