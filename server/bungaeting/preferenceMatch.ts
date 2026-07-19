// 선호 매칭 알림 — 새 번개팅 회차가 열리면 선호 조건에 맞는(알림 받기 ON)
// 유저에게 알림을 보낸다. 채널은 sendSms mock 경유 — 알림톡(Solapi 등) 연동 시
// sendSms 구현 교체만으로 실발송 전환된다 (사업자등록 후).
import type { BungaetingPreference, Event, Trip } from "../../drizzle/schema";
import type { ThemeConfig } from "@shared/types";
import { getBungaetingNotifyTargets } from "../db";
import { sendSms } from "./sms";

const GENDER_MODE_LABELS: Record<string, string> = {
  any: "일반",
  half: "남녀 반반",
  female_only: "여성 전용",
  male_only: "남성 전용",
};

export interface TripMatchInfo {
  genderMode: string;
  ageMin: number | null;
  ageMax: number | null;
}

export interface EventMatchInfo {
  category: string;
  venue: string;
  address: string | null;
}

// 쉼표 목록("부산, 창원")을 공백 제거 토큰 배열로.
function splitTokens(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").map((t) => t.trim()).filter(Boolean);
}

/**
 * 관대한 매칭: 미설정 항목은 통과.
 * - 성비 모드: 선호가 있으면 회차 모드와 일치해야 함
 * - 나이: 선호 범위와 회차 나이 밴드가 겹치면 통과 (null = 그 방향 무제한)
 * - 카테고리: 선호 목록이 있으면 이벤트 카테고리가 포함돼야 함
 * - 지역: 거주/관심지역 토큰 중 하나가 행사 장소/주소에 부분 포함되면 통과
 */
export function matchesPreference(
  pref: Pick<
    BungaetingPreference,
    "preferredGenderMode" | "preferredAgeMin" | "preferredAgeMax" | "preferredRegion" | "interestRegion" | "preferredCategories" | "smsOptIn"
  >,
  trip: TripMatchInfo,
  event: EventMatchInfo
): boolean {
  if (!pref.smsOptIn) return false;

  if (pref.preferredGenderMode && pref.preferredGenderMode !== trip.genderMode) return false;

  // 범위 겹침: [prefMin, prefMax] ∩ [tripMin, tripMax] ≠ ∅ (null = 무제한)
  const prefMin = pref.preferredAgeMin ?? Number.NEGATIVE_INFINITY;
  const prefMax = pref.preferredAgeMax ?? Number.POSITIVE_INFINITY;
  const tripMin = trip.ageMin ?? Number.NEGATIVE_INFINITY;
  const tripMax = trip.ageMax ?? Number.POSITIVE_INFINITY;
  if (prefMin > tripMax || tripMin > prefMax) return false;

  const categories = splitTokens(pref.preferredCategories);
  if (categories.length > 0 && !categories.includes(event.category)) return false;

  const regionTokens = [...splitTokens(pref.preferredRegion), ...splitTokens(pref.interestRegion)];
  if (regionTokens.length > 0) {
    const haystack = `${event.venue} ${event.address ?? ""}`;
    if (!regionTokens.some((t) => haystack.includes(t))) return false;
  }

  return true;
}

const KST_DATE_FMT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  weekday: "short",
});

/**
 * 새 회차 알림 발송 — 개설자 본인 제외, 연락처 없는 유저 제외.
 * 실패는 로그만 남긴다 (회차 생성 플로우를 깨지 않게 호출부에서 fire-and-forget).
 */
export async function notifyMatchingPreferences(
  trip: Pick<Trip, "id" | "creatorId" | "departureAt" | "themeConfig">,
  event: Pick<Event, "title" | "category" | "venue" | "address">
): Promise<number> {
  const cfg = (trip.themeConfig ?? {}) as Partial<ThemeConfig>;
  const tripInfo: TripMatchInfo = {
    genderMode: cfg.genderMode ?? "any",
    ageMin: cfg.ageMin ?? null,
    ageMax: cfg.ageMax ?? null,
  };
  const eventInfo: EventMatchInfo = {
    category: event.category,
    venue: event.venue,
    address: event.address,
  };

  const targets = await getBungaetingNotifyTargets();
  const message =
    `[번개GO 번개팅] 선호 조건에 맞는 새 회차가 열렸어요! ` +
    `${event.title} · ${KST_DATE_FMT.format(new Date(trip.departureAt))} 출발 · ` +
    `${GENDER_MODE_LABELS[tripInfo.genderMode] ?? tripInfo.genderMode} → ` +
    `https://bungaego.com/bungaeting/trips/${trip.id}`;

  let sent = 0;
  for (const target of targets) {
    if (target.userId === trip.creatorId) continue;
    if (!target.phone) continue;
    if (!matchesPreference(target.pref, tripInfo, eventInfo)) continue;
    try {
      await sendSms(target.phone, message);
      sent++;
    } catch (error) {
      console.warn(`[preferenceMatch] notify failed for user ${target.userId}:`, error);
    }
  }
  return sent;
}
