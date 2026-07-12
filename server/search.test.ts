import { describe, expect, it } from "vitest";
import { escapeLikePattern, normalizeSearchTerm } from "./search";

describe("normalizeSearchTerm", () => {
  it("lowercases and trims", () => {
    expect(normalizeSearchTerm("  CORTIS  ")).toEqual(["cortis"]);
  });

  it("splits on whitespace into multiple tokens", () => {
    expect(normalizeSearchTerm("코르티스 서울")).toEqual(["코르티스", "서울"]);
  });

  it("collapses repeated internal whitespace", () => {
    expect(normalizeSearchTerm("코르티스   서울\t투어")).toEqual(["코르티스", "서울", "투어"]);
  });

  it("returns an empty array for blank input", () => {
    expect(normalizeSearchTerm("")).toEqual([]);
    expect(normalizeSearchTerm("   ")).toEqual([]);
  });

  it("keeps mixed Korean/English tokens intact", () => {
    expect(normalizeSearchTerm("KPOP 콘서트")).toEqual(["kpop", "콘서트"]);
  });
});

describe("escapeLikePattern", () => {
  it("escapes LIKE wildcards and the escape char with '!'", () => {
    expect(escapeLikePattern("50%")).toBe("50!%");
    expect(escapeLikePattern("a_b")).toBe("a!_b");
    expect(escapeLikePattern("x!y")).toBe("x!!y");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeLikePattern("cortis")).toBe("cortis");
  });
});
