import { describe, expect, it } from "vitest";
import { isStaticAssetRequest, isWriteMutationRequest } from "./rateLimiters";

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

describe("isStaticAssetRequest", () => {
  it("matches Vite dev-tooling path prefixes", () => {
    expect(isStaticAssetRequest("/@vite/client")).toBe(true);
    expect(isStaticAssetRequest("/@fs/D:/pjrally/BungaeGo/node_modules/foo.js")).toBe(true);
    expect(isStaticAssetRequest("/src/main.tsx")).toBe(true);
    expect(isStaticAssetRequest("/node_modules/.vite/deps/react.js")).toBe(true);
  });

  it("matches static asset file extensions", () => {
    expect(isStaticAssetRequest("/assets/index-abc123.js")).toBe(true);
    expect(isStaticAssetRequest("/assets/index-abc123.css")).toBe(true);
    expect(isStaticAssetRequest("/components/Map.tsx")).toBe(true);
    expect(isStaticAssetRequest("/lib/utils.ts")).toBe(true);
  });

  it("does not match API routes, even ones that look path-like", () => {
    expect(isStaticAssetRequest("/events.list")).toBe(false);
    expect(isStaticAssetRequest("/reservations.create")).toBe(false);
    expect(isStaticAssetRequest("/oauth/kakao/login")).toBe(false);
  });
});
