// 추천 적립액 공식 (referral-credit-spec §4.2):
// floor(실결제액 × 생성 시점 스냅샷 요율), 요율 무관 공통 상한(capKrw) 적용.
// 예: 43,000원 → 참가자(5%) 2,150 / 기본(2%) 860. 120,000원 → 5,000(캡) / 2,400.
export function computeReferralReward(paidAmount: number, rate: number, capKrw: number): number {
  if (paidAmount <= 0 || rate <= 0) return 0;
  return Math.min(Math.floor(paidAmount * rate), capKrw);
}
