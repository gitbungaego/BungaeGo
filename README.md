# 번개GO

이벤트/공연 방향 셔틀버스 공동 예약 플랫폼.

## 시작하기

1. `.env.example`을 복사해 `.env`로 저장하고 값을 채웁니다.
2. `pnpm install`
3. `pnpm dev`

## 환경 변수

- `FEATURE_THEMES` — 테마 트립(`standard` 외 테마) 생성/노출 기능 플래그. `true`가 아니면 비표준 테마 트립은 생성이 막히고 목록에서도 제외됩니다.
- `DATABASE_URL` — **프로덕션 DB명은 `test`**임 (프로젝트명 `bungaego`와 혼동 주의 - 실제로 한 번 사고 났음). DATABASE_URL 재구성 시 반드시 확인할 것.
