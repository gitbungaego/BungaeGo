import { describe, expect, it } from "vitest";
import { calculateAge, isWithinAgeBand } from "./age";

// KST 기준. UTC 인스턴트를 넘겨 KST 벽시계 달력일로 환산되는지 함께 검증한다.
const kstNoon = (y: number, mo: number, d: number) =>
  new Date(Date.UTC(y, mo - 1, d, 3, 0)); // 12:00 KST = 03:00 UTC

describe("calculateAge", () => {
  it("생일이 지났으면 나이가 오른다", () => {
    expect(calculateAge("2000-03-10", kstNoon(2026, 3, 11))).toBe(26);
  });

  it("생일 당일이면 그 나이가 된다", () => {
    expect(calculateAge("2000-03-10", kstNoon(2026, 3, 10))).toBe(26);
  });

  it("생일 하루 전이면 아직 한 살 어리다", () => {
    expect(calculateAge("2000-03-10", kstNoon(2026, 3, 9))).toBe(25);
  });

  it("KST 자정 경계: UTC로는 전날이어도 KST 달력일로 판정한다", () => {
    // 2026-03-10 00:30 KST == 2026-03-09 15:30 UTC. KST 달력일은 3/10이므로 생일 당일.
    const asOf = new Date(Date.UTC(2026, 2, 9, 15, 30));
    expect(calculateAge("2000-03-10", asOf)).toBe(26);
  });

  it("연 나이가 아니라 만 나이다 (같은 해 태생이라도 생일 전엔 안 오름)", () => {
    expect(calculateAge("2007-12-31", kstNoon(2026, 1, 1))).toBe(18);
  });
});

describe("isWithinAgeBand", () => {
  it("구간 안이면 true", () => {
    expect(isWithinAgeBand(30, 27, 35)).toBe(true);
  });
  it("경계값 포함", () => {
    expect(isWithinAgeBand(27, 27, 35)).toBe(true);
    expect(isWithinAgeBand(35, 27, 35)).toBe(true);
  });
  it("구간 밖이면 false", () => {
    expect(isWithinAgeBand(26, 27, 35)).toBe(false);
    expect(isWithinAgeBand(36, 27, 35)).toBe(false);
  });
  it("null 경계는 무제한", () => {
    expect(isWithinAgeBand(80, 27, null)).toBe(true);
    expect(isWithinAgeBand(1, null, 35)).toBe(true);
    expect(isWithinAgeBand(50, null, null)).toBe(true);
  });
});
