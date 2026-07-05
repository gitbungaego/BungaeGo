# 프로덕션 마이그레이션 적용 계획

**작성 시점(2026-07-05) 기준 긴급 배경**: P1~P6 커밋 8개가 이미 `origin/main`에 push되어 있습니다
(`7dc9e2a`, 19:13 KST). 프로덕션(Railway, `bungaego.com`)의 응답 헤더상 마지막 배포는
17:35 KST로 아직 이 push를 반영하지 않은 것으로 보이지만, GitHub push 기반 자동배포이므로
곧/이미 새 코드가 배포될 수 있습니다. 새 코드는 `users.status`, `consents` 테이블을
참조하는데, 프로덕션 DB에는 아직 없습니다 (`consents` 테이블 없음, `users`에 `status`
컬럼 없음 — 2026-07-05 확인). 이 문서의 **Stage A는 그래서 우선순위가 높습니다.**

## 현재 상태 (읽기 전용 확인 완료, 2026-07-05)

| 마이그레이션 | 내용 | 프로덕션 적용 여부 |
|---|---|---|
| 0001~0002 | 초기 테이블(boarding_points/events/points/referrals/reservations/trips 등), users 프로필 컬럼 | ✅ 적용됨 |
| 0003 | events.category enum 값 변경(awards 제거, rally 추가) | ✅ 적용됨 (이전 세션에서 검증 완료) |
| 0004 | reservations.seatNo, trips.theme/themeConfig, users 인증 관련 컬럼 | ✅ 적용됨 |
| 0005 | payments/payment_items 테이블 신설 | ✅ 적용됨 |
| **0006** | reservations의 구 결제 컬럼 6개(`status`/`totalAmount`/`paymentId`/`paymentMethod`/`cancelledAt`/`cancelReason`) DROP | ⏸️ **의도적으로 보류 중** — 새 코드가 안정적으로 며칠 돌아간 뒤 적용 |
| **0007** | `consents` 테이블 신설, `users.status` enum 컬럼 추가 | ❌ **미적용 — Stage A에서 지금 적용 필요** |

0006과 0007은 서로 의존관계가 없는 독립적인 변경입니다. **번호 순서(0006→0007)가 아니라
"추가만 하는 것 먼저, 제거는 나중"** 원칙에 따라 **0007을 먼저**, 0006은 코드가 안정화된
뒤 별도로 적용합니다.

## Stage A — 지금: 0007 적용 (추가만, 안전)

### A-1. 백업 체크리스트 (TiDB Cloud 콘솔 스냅샷 사용)

- [ ] TiDB Cloud 콘솔 → 해당 클러스터 → Backup 메뉴에서 온디맨드(수동) 백업 스냅샷 생성
- [ ] 스냅샷 상태가 "완료"로 바뀔 때까지 대기
- [ ] 스냅샷 생성 시각 기록 (롤백 시 필요)

### A-2. 0007 적용

`.env.production.local`에 실제 프로덕션 `DATABASE_URL`이 있다고 가정합니다.

```bash
node -r dotenv/config scripts/apply-0007-migration.cjs dotenv_config_path=.env.production.local
```

`scripts/apply-0007-migration.cjs`는 `drizzle/0007_striped_shotgun.sql`을
`--> statement-breakpoint` 기준으로 나눠 순서대로 실행합니다 (기존 `apply-0006-migration.cjs`와
동일한 패턴). 적용될 구문:

```sql
CREATE TABLE `consents` (...);
ALTER TABLE `users` ADD `status` enum('active','suspended') DEFAULT 'active' NOT NULL;
CREATE INDEX `consents_user_type_idx` ON `consents` (`userId`,`type`);
```

`status` 컬럼은 `DEFAULT 'active' NOT NULL`이라 기존 유저 행 전부 자동으로 `active`가
됩니다 — 별도 백필 불필요.

### A-3. 검증 쿼리

```sql
SHOW TABLES;                        -- consents 포함 13개 테이블 확인
SHOW COLUMNS FROM users;             -- status 컬럼 존재 확인
SHOW COLUMNS FROM consents;          -- id/userId/type/version/agreedAt 확인
SELECT COUNT(*) FROM users WHERE status = 'active';  -- 기존 유저 수와 일치하는지
SELECT COUNT(*) FROM consents;       -- 0 (신규 테이블, 아직 데이터 없음)
```

### A-4. 코드 배포 확인

- [ ] Railway 배포 로그/대시보드에서 최신 커밋(`7dc9e2a`)이 실제로 배포됐는지 확인
- [ ] 배포 후 `curl -sI https://bungaego.com/`의 `last-modified`가 갱신됐는지 재확인
- [ ] 카카오 로그인 1회 테스트 → `consents` 테이블에 `type='tos'` 행이 생기는지 확인

## Stage B — 나중에 (새 코드가 며칠 안정적으로 운영된 뒤): 0006 적용

**먼저 확인**: Stage A 배포 이후 신규 예약이 정상적으로 `payments`/`payment_items`에
기록되고 있는지, 관리자 대시보드 매출 통계가 정상인지 충분히 지켜본 뒤 진행하세요.
서두를 이유 없는 파괴적 변경입니다.

### B-1. 백업 체크리스트

- [ ] TiDB Cloud 콘솔에서 다시 한번 온디맨드 스냅샷 생성 (Stage A 이후 상태 기준)

### B-2. 0006 적용

```bash
node -r dotenv/config scripts/apply-0006-migration.cjs dotenv_config_path=.env.production.local
```

적용될 구문 (전부 DROP, 되돌릴 수 없음):

```sql
ALTER TABLE `reservations` DROP COLUMN `status`;
ALTER TABLE `reservations` DROP COLUMN `totalAmount`;
ALTER TABLE `reservations` DROP COLUMN `paymentId`;
ALTER TABLE `reservations` DROP COLUMN `paymentMethod`;
ALTER TABLE `reservations` DROP COLUMN `cancelledAt`;
ALTER TABLE `reservations` DROP COLUMN `cancelReason`;
```

### B-3. 검증 쿼리

```sql
SHOW COLUMNS FROM reservations;  -- 위 6개 컬럼이 사라졌는지, seatNo는 남아있는지 확인
SELECT COUNT(*) FROM reservations;  -- 행 수가 Stage B 이전과 동일한지 (DROP COLUMN은 행을 지우지 않음)
```

## 참고

- 이 저장소는 `drizzle-kit migrate`/`db:push`를 프로덕션에 직접 쓰지 않습니다
  (`__drizzle_migrations` 추적 테이블이 없고 과거 이력이 깨져 있어 재적용을 시도하면
  "already exists" 류 오류로 실패합니다). 항상 `scripts/apply-000N-migration.cjs`처럼
  해당 SQL 파일만 직접 실행하는 방식을 씁니다.
- `.env.production.local`은 gitignore 대상이며 이 문서 작성 시점에 커밋 스테이징에
  포함되지 않은 것을 확인했습니다.
