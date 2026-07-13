// 만 나이 계산 (KST 달력 기준). 한국식 나이·연(年) 나이 사용 금지 — 생일 경과 기준의
// 만 나이만 쓴다 (spec §2). 번개팅 나이 밴드 판정 기준일은 "탑승일"(trip.departureAt).
//
// birthDate: 'YYYY-MM-DD' (프로필에 문자열로 저장), asOf: 판정 기준 시각(UTC 인스턴트).
// asOf를 KST 벽시계 달력일로 환산한 뒤 birthDate와 월/일을 비교한다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function calculateAge(birthDate: string, asOf: Date): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const kst = new Date(asOf.getTime() + KST_OFFSET_MS);
  const ay = kst.getUTCFullYear();
  const am = kst.getUTCMonth() + 1;
  const ad = kst.getUTCDate();
  let age = ay - by;
  if (am < bm || (am === bm && ad < bd)) age -= 1;
  return age;
}

// 나이 밴드(min~max, 만 나이 포함 구간) 판정. min/max가 null이면 그 방향은 무제한.
export function isWithinAgeBand(
  age: number,
  ageMin: number | null | undefined,
  ageMax: number | null | undefined
): boolean {
  if (ageMin != null && age < ageMin) return false;
  if (ageMax != null && age > ageMax) return false;
  return true;
}
