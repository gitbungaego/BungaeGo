import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return { ...actual, getBungaetingNotifyTargets: vi.fn() };
});
vi.mock("./sms", () => ({ sendSms: vi.fn().mockResolvedValue(undefined) }));

import * as db from "../db";
import { sendSms } from "./sms";
import { matchesPreference, notifyMatchingPreferences } from "./preferenceMatch";

const basePref = {
  preferredGenderMode: null,
  preferredAgeMin: null,
  preferredAgeMax: null,
  preferredRegion: null,
  interestRegion: null,
  preferredCategories: null,
  smsOptIn: true,
};
const trip = { genderMode: "half", ageMin: 25, ageMax: 35 };
const event = { category: "concert", venue: "부산 사직야구장", address: "부산 동래구" };

afterEach(() => {
  vi.mocked(db.getBungaetingNotifyTargets).mockReset();
  vi.mocked(sendSms).mockClear();
});

describe("matchesPreference — 관대한 매칭 (미설정 = 통과)", () => {
  it("전부 미설정 + 알림 ON → 통과", () => {
    expect(matchesPreference(basePref, trip, event)).toBe(true);
  });

  it("알림 받기 OFF → 항상 제외", () => {
    expect(matchesPreference({ ...basePref, smsOptIn: false }, trip, event)).toBe(false);
  });

  it("성비 모드: 일치 통과 / 불일치 제외", () => {
    expect(matchesPreference({ ...basePref, preferredGenderMode: "half" }, trip, event)).toBe(true);
    expect(matchesPreference({ ...basePref, preferredGenderMode: "female_only" }, trip, event)).toBe(false);
  });

  it("나이: 범위가 겹치면 통과, 안 겹치면 제외", () => {
    expect(matchesPreference({ ...basePref, preferredAgeMin: 30, preferredAgeMax: 40 }, trip, event)).toBe(true);
    expect(matchesPreference({ ...basePref, preferredAgeMin: 40, preferredAgeMax: 50 }, trip, event)).toBe(false);
    // 회차 나이 밴드 무제한이면 어떤 선호도 통과
    expect(
      matchesPreference({ ...basePref, preferredAgeMin: 60, preferredAgeMax: 70 }, { ...trip, ageMin: null, ageMax: null }, event)
    ).toBe(true);
  });

  it("카테고리: 목록에 포함되면 통과", () => {
    expect(matchesPreference({ ...basePref, preferredCategories: "concert,festival" }, trip, event)).toBe(true);
    expect(matchesPreference({ ...basePref, preferredCategories: "sports" }, trip, event)).toBe(false);
  });

  it("지역: 거주/관심지역 토큰이 장소·주소에 부분 포함되면 통과", () => {
    expect(matchesPreference({ ...basePref, preferredRegion: "부산" }, trip, event)).toBe(true);
    expect(matchesPreference({ ...basePref, interestRegion: "서울, 동래" }, trip, event)).toBe(true);
    expect(matchesPreference({ ...basePref, preferredRegion: "서울", interestRegion: "창원" }, trip, event)).toBe(false);
  });
});

describe("notifyMatchingPreferences", () => {
  const tripRow = {
    id: 42,
    creatorId: 1,
    departureAt: new Date("2026-09-04T07:00:00Z"),
    themeConfig: { genderMode: "half", ageMin: 25, ageMax: 35 },
  };
  const eventRow = { title: "IM HERO", category: "concert", venue: "부산 사직야구장", address: null };

  it("매칭 유저에게만 발송 — 개설자·연락처 없음·알림 OFF·조건 불일치 제외", async () => {
    vi.mocked(db.getBungaetingNotifyTargets).mockResolvedValue([
      { userId: 1, phone: "010-1", pref: { ...basePref } as any }, // 개설자 → 제외
      { userId: 2, phone: null, pref: { ...basePref } as any }, // 연락처 없음 → 제외
      { userId: 3, phone: "010-3", pref: { ...basePref, preferredGenderMode: "male_only" } as any }, // 불일치
      { userId: 4, phone: "010-4", pref: { ...basePref, preferredCategories: "concert" } as any }, // 매칭
    ]);

    const sent = await notifyMatchingPreferences(tripRow as any, eventRow as any);
    expect(sent).toBe(1);
    expect(sendSms).toHaveBeenCalledTimes(1);
    const [phone, message] = vi.mocked(sendSms).mock.calls[0];
    expect(phone).toBe("010-4");
    expect(message).toContain("IM HERO");
    expect(message).toContain("남녀 반반");
    expect(message).toContain("/bungaeting/trips/42");
  });

  it("발송 실패는 다른 대상 발송을 막지 않는다", async () => {
    vi.mocked(db.getBungaetingNotifyTargets).mockResolvedValue([
      { userId: 5, phone: "010-5", pref: { ...basePref } as any },
      { userId: 6, phone: "010-6", pref: { ...basePref } as any },
    ]);
    vi.mocked(sendSms).mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(undefined);

    const sent = await notifyMatchingPreferences(tripRow as any, eventRow as any);
    expect(sent).toBe(1);
    expect(sendSms).toHaveBeenCalledTimes(2);
  });
});
