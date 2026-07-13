// SMS 알림 mock (spec §6). 실채널(Solapi 등)은 사업자등록 후 연동 — 지금은 console.log만.
// 실사용자 오픈 전제조건(§7): 알림이 console.log면 운영 불가이므로 오픈 전 실연동 필수.
// TODO: Solapi 등 실 SMS 채널 연동. sendSms 시그니처는 그대로 두고 구현만 교체.
export async function sendSms(phone: string, message: string): Promise<void> {
  console.log(`[MockSMS -> ${phone}] ${message}`);
}
