export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  kakaoRestApiKey: process.env.KAKAO_REST_API_KEY ?? "",
  kakaoClientSecret: process.env.KAKAO_CLIENT_SECRET ?? "",
  // 의도적으로 REQUIRED_ENV_VARS에 넣지 않는다: 없으면 toss 결제수단만
  // 비활성화되고(mock은 그대로 동작), 있으면 활성화된다. 라이브 전환은
  // 테스트 키 → 라이브 키 교체만으로 끝난다.
  tossSecretKey: process.env.TOSS_SECRET_KEY ?? "",
};

// D-7 자동 배차 스케줄러 실행 여부. 기본 false(dry-run: 대상 조회·로그만).
// 2단계 롤아웃 — dry-run으로 배포해 로그를 관찰한 뒤 true로 켠다. 스케줄러가
// 매 틱 process.env를 읽으므로(캐시 X) 재배포 없이 토글 가능하고, 테스트도
// vi.stubEnv로 제어할 수 있다.
export function isAutoMatchingEnabled(): boolean {
  return process.env.AUTO_MATCHING_ENABLED === "true";
}

const REQUIRED_ENV_VARS = ["JWT_SECRET", "DATABASE_URL"] as const;

// Fail fast at boot rather than silently running with an empty JWT signing
// key (forgeable sessions) or no database connection string.
export function validateRequiredEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
}
