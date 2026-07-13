import type { Gender } from "../../drizzle/schema";

// 본인인증 어댑터. 성인·실명 인증은 번개팅 안전의 근간(spec §7) — 익명 채팅+사진+
// 나이 밴드가 있는 서비스라 미성년자 유입을 막아야 한다.
//
// 계약 전에는 mock 어댑터로 개발하되 실사용자 오픈은 금지(spec §7 전제 조건).
// TODO: 사업자등록 후 포트원(PortOne) 본인인증으로 교체. 실제 어댑터는 인증 기관에서
// 성별·생년월일·실명을 받아오므로 클라이언트가 보낸 값을 신뢰하지 않는다.

export interface VerificationResult {
  provider: string;
  verifiedAt: Date;
  gender: Gender;
  birthDate: string; // 'YYYY-MM-DD'
  name?: string;
}

export interface VerificationInput {
  gender: Gender;
  birthDate: string; // 'YYYY-MM-DD'
}

export interface VerificationAdapter {
  verify(input: VerificationInput): Promise<VerificationResult>;
}

// mock: 사용자가 입력한 성별/생년월일을 그대로 '인증됨'으로 통과시킨다.
// 실연동 지점 — 이 클래스만 교체하면 나머지 온보딩 로직은 그대로 동작한다.
class MockVerificationAdapter implements VerificationAdapter {
  async verify(input: VerificationInput): Promise<VerificationResult> {
    return {
      provider: "mock",
      verifiedAt: new Date(),
      gender: input.gender,
      birthDate: input.birthDate,
    };
  }
}

export const verificationAdapter: VerificationAdapter = new MockVerificationAdapter();
