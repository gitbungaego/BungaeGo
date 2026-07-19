// 알림 채널 mock — 지금은 console.log만. 실채널(카카오 알림톡, Solapi 등)은
// 사업자등록 + 비즈니스 채널 인증 + 템플릿 승인 후 연동한다 (2026-07-19 결정: 이연).
// 선호 매칭 새 회차 알림(preferenceMatch.ts)·추천 적립·포인트 만료 알림이 전부
// 이 함수를 경유하므로, 구현만 교체하면 전 알림이 실발송으로 전환된다.
// TODO: 알림톡(Solapi 등) 연동. sendSms 시그니처는 그대로 두고 구현만 교체.
export async function sendSms(phone: string, message: string): Promise<void> {
  console.log(`[MockSMS -> ${phone}] ${message}`);
}
