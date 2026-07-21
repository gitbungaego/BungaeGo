import { describe, expect, it } from "vitest";
import { CATALOG_STRINGS } from "./catalog";
import { LOCALES } from "./locales";

const CODES = LOCALES.map((l) => l.code);

// 모든 키가 5개 언어 전부에 비어있지 않은 값을 갖고, {var} 플레이스홀더가
// 언어별로 동일하게 보존됐는지 검증 (누락 시 한국어 폴백이지만 회귀 방지).
describe("i18n catalog", () => {
  it("모든 키가 5개 언어 값을 가진다", () => {
    for (const [key, row] of Object.entries(CATALOG_STRINGS)) {
      for (const code of CODES) {
        expect(row[code], `${key}.${code}`).toBeTruthy();
      }
    }
  });

  it("{var} 플레이스홀더가 언어별로 동일하다", () => {
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(",");
    for (const [key, row] of Object.entries(CATALOG_STRINGS)) {
      const koVars = placeholders(row.ko);
      for (const code of CODES) {
        expect(placeholders(row[code]), `${key}.${code} placeholders`).toBe(koVars);
      }
    }
  });
});
