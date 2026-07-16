# 배포 런북 — 스키마 변경 배포 절차

> **한 줄 요약: 스키마를 바꾸는 배포는 반드시 "① DB 먼저 → ② 검증 → ③ 코드 나중" 순서로 한다.**
> 순서를 뒤집으면(코드 먼저 배포) 새 컬럼/테이블을 참조하는 코드가 아직 없는 스키마를 조회해 **`events.list`부터 500**이 난다.

## 왜 이 순서가 강제되는가

Railway 배포는 **마이그레이션을 자동 실행하지 않는다.**

- `start` 스크립트는 `node dist/index.js`뿐 — 부팅 시 마이그레이션 단계가 없다.
- `db:push`의 `drizzle-kit migrate`는 이 저장소에서 **작동하지 않는다**: `drizzle/meta/_journal.json`이 `0000_little_sprite`를 참조하는데 `drizzle/0000_little_sprite.sql` 파일이 커밋된 적이 없어(0000 baseline 누락), `readMigrationFiles`가 첫 항목에서 바로 실패한다.
- 그래서 프로덕션 스키마는 지금까지 **수동 `scripts/apply-*.cjs`** 스크립트로 적용해 왔고, 프로덕션에는 drizzle의 `__drizzle_migrations` 추적 테이블도 없다.

즉, **코드 배포와 스키마 적용은 완전히 분리된 두 단계**이며, 사람이 순서를 지켜야 한다.

## 스키마 변경 배포 절차 (매번 이 순서)

### ① 로컬에서 마이그레이션 생성 + 적용 스크립트 준비

```bash
# schema.ts 수정 후
npx drizzle-kit generate           # drizzle/00NN_*.sql 생성
# 새 번호에 맞춘 apply 스크립트를 직전 것 복사해서 만든다
cp scripts/apply-00{N-1}-migration.cjs scripts/apply-00NN-migration.cjs
#   그 안의 파일명 문자열(0013_bumpy_genesis 등)을 새 tag로 교체
node scripts/apply-00NN-migration.cjs   # 로컬 DB(.env)에 적용
```

`apply-*.cjs`는 `require('dotenv/config')`로 `DATABASE_URL`을 읽는다 — 아무 인자 없이 실행하면 **로컬** `.env`를 쓴다.

### ② 프로덕션 DB에 먼저 적용

프로덕션 `DATABASE_URL`은 `.env.production.local`에 있다. 환경변수로 넘겨 실행한다(dotenv는 이미 설정된 env를 덮어쓰지 않으므로 프로덕션 URL이 우선한다):

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.production.local | sed 's/^DATABASE_URL=//')"
# 대상이 프로덕션인지 반드시 확인
node -e 'console.log("target host:", new URL(process.env.DATABASE_URL).hostname)'
#   → gateway01.ap-northeast-1.prod.aws.tidbcloud.com 이어야 함

node scripts/apply-00NN-migration.cjs
```

여러 개가 밀려 있으면 번호 순서대로 전부 적용한다.

### ③ DESCRIBE로 검증

적용된 컬럼/테이블이 실제로 존재하는지 `information_schema`로 확인한다:

```bash
node -e '
const mysql=require("mysql2/promise");const u=new URL(process.env.DATABASE_URL);
(async()=>{const c=await mysql.createConnection({host:u.hostname,port:u.port||3306,user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:u.pathname.slice(1),ssl:u.searchParams.get("ssl")==="true"?{rejectUnauthorized:true}:undefined});
const [cols]=await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ",["events"]);
console.log(cols.map(r=>r.column_name||r.COLUMN_NAME).join(", "));
await c.end();})();
'
```

### ④ 코드 push + 배포

DB가 준비된 것을 확인한 **뒤에만** 코드를 올린다:

```bash
git push origin main
railway up          # production 서비스 bungaego-server 빌드·배포
```

### ⑤ 배포 후 스모크 체크

```bash
# events.list 200
curl -s -o /dev/null -w "%{http_code}\n" "https://bungaego.com/api/trpc/events.list?input=%7B%22json%22%3A%7B%22limit%22%3A24%7D%7D"
# kakao 로그인 302
curl -s -o /dev/null -w "%{http_code}\n" "https://bungaego.com/api/oauth/kakao/login"
```

## 안전 원칙

- **Expand-first (추가형 우선)**: 신규 테이블·nullable 컬럼·enum 값 추가처럼 **기존 데이터와 현재 실행 중인 구버전 코드에 무해한** 변경만 코드보다 먼저 적용한다. 이러면 ②에서 DB를 바꿔도 아직 배포 전인 구버전 앱은 그대로 동작하고, ④에서 새 코드가 준비된 스키마 위로 올라온다.
- **컬럼 삭제/이름변경/NOT NULL 강제** 같은 파괴적/비호환 변경은 별도 다단계 절차(먼저 코드에서 사용 중단 배포 → 나중에 컬럼 제거)가 필요하다. 한 번에 하지 말 것.
- 프로덕션 DDL 실행 전에는 **어떤 DDL이 나가는지 목록으로 확인**하고 진행한다.

## 지금까지 적용된 마이그레이션 기록

> ⚠️ **2026-07-13 실측 갱신**: 아래 표는 기록이 아니라 `scripts/check-schema-drift.cjs`로 로컬 스키마와 프로덕션(`test`) information_schema를 **직접 비교한 결과**를 반영한다. 이전 버전은 "0001–0009 적용됨"으로 잘못 기록되어 있었는데, 실제로는 **0002와 0009가 프로덕션에 적용된 적이 없었다** — 로컬 `.env`가 며칠간 별도 TiDB DB(`bungaego`, 유령 DB)를 가리키고 있어서 로컬 검증이 프로덕션과 어긋난 채로도 티가 안 났다. 앞으로는 추측 대신 이 스크립트로 확인한다.

| # | tag | 내용 | 프로덕션 |
|---|-----|------|:---:|
| 0001 | mysterious_betty_ross | 기본 스키마(users, events, trips, reservations, payments 등 baseline) | 적용됨 |
| 0002 | flippant_firedrake | reservations: `status`/`totalAmount`/`paymentId`/`paymentMethod`/`cancelledAt`/`cancelReason` 컬럼 제거 (payments 테이블로 이관) | **미적용** — 프로덕션 reservations에 6개 컬럼이 아직 남아있음 |
| 0003–0008 | (중간 스키마 변경) | ride_requests/clusters/stop_candidates 등 매칭 파이프라인 스키마 | 적용됨 |
| 0009 | lethal_trauma | `rally_point_candidates` 테이블 신규 생성 | 적용됨(실측 2026-07-13, `scripts/apply-0009-migration.cjs` + `seedRallyPoints.ts` 15건) |
| 0010 | parallel_the_phantom | payments: `reservationId` nullable화, `method` enum에 `toss`, `orderId`(unique)/`tossPaymentKey`/`orderContext` 추가 | 적용됨 |
| 0011 | solid_molten_man | payments: `rideRequestId`, `refundedAmount` + 인덱스 | 적용됨 |
| 0012 | curved_jimmy_woo | events: `matchingFrozenBy` enum('admin','auto') | 적용됨 |
| 0013 | bumpy_genesis | `event_likes` 테이블 (UNIQUE(eventId,userId)) | 적용됨 |
| 0014 | loose_black_panther | events: `searchAliases`, `tags` (검색 별칭/태그) | 적용됨 |
| 0015 | lowly_lester | events: `status` enum에 `deleted` 추가 (cascade 삭제) | 적용됨 |
| 0016 | zippy_hulk | `point_interests` 테이블 (UNIQUE(eventId,rallyPointCandidateId,userId)) | 적용됨 |
| 0017 | overrated_sleeper | 번개팅 `bungaeting_profiles`, `bungaeting_preferences` 테이블 | 적용됨(실측 2026-07-13). 스키마만 배포, 기능은 FEATURE_BUNGAETING OFF라 미노출 |
| 0018 | amazing_vindicator | trips: `cancelReason` enum에 `gender_ratio_not_met` 추가 (번개팅 성비 미달 자동취소, 순수 추가형) | 적용됨(실측 2026-07-13) |
| 0019 | absent_shadow_king | trips: `openChatUrl` varchar(500) 추가 (번개팅 회차 카카오 오픈채팅 링크, nullable 순수 추가형) | 적용됨(실측 2026-07-14) |
| 0020 | parallel_bastion | 번개팅 `bungaeting_trip_proposals`, `bungaeting_proposal_interests` 테이블 (회차 제안 + 찜) | 적용됨(실측 2026-07-14) |
| 0021 | harsh_multiple_man | 번개팅 `bungaeting_reports` 테이블 (프로필 신고, 관리자 처리) | 적용됨(실측 2026-07-14) |
| 0022 | awesome_quasar | events: `category` enum에 `local_festival`/`expo`/`fair`/`forum` 추가 (홈 카테고리 칩, 순수 추가형) | 적용됨(실측 2026-07-16) |
| 0023 | medical_mindworm | `event_requests`(이벤트 만들기 신청서) + `shuttle_demands`(희망 탑승지 수요, UNIQUE(eventId,userId)) 테이블 | 적용됨(실측 2026-07-16) |
| 0024 | outstanding_the_stranger | `event_requests.arrivalTime` varchar(10) 추가 (희망 도착 시각, nullable 순수 추가형) | 적용됨(실측 2026-07-16) |
| 0025 | lucky_metal_master | `event_requests.startTime`/`endTime` varchar(5) 추가 (행사 일정 시작/종료 시각, nullable 순수 추가형) | 적용됨(실측 2026-07-16) |
| 0026 | violet_greymalkin | `trips.oneWayPrice` int + `reservations.ticketType` enum(round/outbound/inbound) DEFAULT 'round' (탑승권 왕복/행사장행/귀가행, 순수 추가형) | 적용됨(실측 2026-07-17) |

> **번개팅 배포 상태 (2026-07-15 갱신)**: 번개팅 **①~⑦ 전 단계**의 스키마(0017~0021)·코드가
> 프로덕션에 배포됐고, **운영자 결정으로 `FEATURE_BUNGAETING`/`VITE_FEATURE_BUNGAETING`를
> Railway에 true로 설정해 기능이 공개(활성) 상태다** — 번개팅 탭·온보딩·회차·셔틀만들기 토글이
> 실사용자에게 노출된다.
>
> ⚠️ **알려진 리스크(운영자 인지 하에 공개)**: spec §7 전제조건 중 본인인증(포트원)·실결제(토스
> 라이브)·SMS 실채널·사진 스토리지가 **아직 mock**이다 — 실사용자가 mock 인증으로 가입하고
> mock 결제로 신청 가능. 실연동 전까지 운영에 주의하고, 문제가 생기면 두 플래그를 지우고
> `railway up`으로 즉시 재비활성화할 수 있다(스키마·코드는 유지됨).
>
> 구현 범위: ① 프로필/온보딩/선호 · ② 성비 모드 트립+좌석락+예약자격 · ③ D-5 확정+성비 판정 ·
> ④ 참가자 프로필 공개(3중 접근제어) · ⑤ 카카오 오픈채팅 링크(인앱채팅 대신) · ⑥ 제안/찜/제안자
> 포인트 보상 · ⑦ 관리자 콘솔(번개팅 탭). mock 지점(본인인증·SMS·이미지)은 실연동 TODO로 표시됨.

**0002는 보류 중** — 프로덕션 `reservations`에 남은 4행(전부 개발자 본인의 테스트/스모크 데이터, 실사용자 없음 — [RESERVATIONS_LEGACY_COLUMNS.md](./RESERVATIONS_LEGACY_COLUMNS.md) 참고) 유실을 동반하는 파괴적 변경이라 별도 세션에서 백업 후 진행 예정.

프로덕션 DB: **TiDB Cloud `test`** (`gateway01.ap-northeast-1.prod.aws.tidbcloud.com`).

## 환경 원칙 — 로컬 DB와 프로덕션 DB는 반드시 분리

- **로컬 개발**: `localhost` MySQL의 `bungaego_dev` (반드시 로컬 인스턴스, TiDB 아님).
- **프로덕션**: TiDB Cloud `test` (`gateway01.ap-northeast-1.prod.aws.tidbcloud.com`) — 정식 스키마명으로 개명 예정이나 현재는 `test`.
- **로컬 `.env`에는 절대 프로덕션(TiDB) `DATABASE_URL`을 넣지 않는다.** 프로덕션 접속 정보는 오직 `.env.production.local`(gitignore 대상)에만 둔다.
- 2026-07-13 사고: 로컬 `.env`의 `DATABASE_URL`이 실수로 TiDB `bungaego`(별도 dev 스키마)를 가리키고 있던 채로 며칠간 방치됨 → 로컬에서 검증한 화면/기능이 실제로는 프로덕션과 다른 DB를 보고 있었고, 그 사이 나간 마이그레이션 0002/0009가 프로덕션에 누락되는 걸 못 알아챔. 이 사고를 계기로 로컬 DB를 완전히 별도 로컬 MySQL 인스턴스(`bungaego_dev`)로 분리했다.
- 옛 TiDB `bungaego` 스키마는 데이터를 그대로 `bungaego_ghost_20260712`로 이전(테이블 단위 `RENAME TABLE`)해 원래 이름을 없앴다. **`bungaego_ghost_20260712`는 2026-07-19 이후 삭제 예정**(1주일 안전망). 내용은 전부 개발용 시드/테스트 데이터로 확인됨(실사용자 데이터 없음 — id 범위가 프로덕션과 안 겹치고, `rally_point_candidates` 15건은 `seedRallyPoints.ts` 시드와 정확히 일치).
- **배포 전 선택 실행**: `DATABASE_URL=<로컬> TARGET_DATABASE_URL=<프로덕션> node scripts/check-schema-drift.cjs`로 로컬과 프로덕션 스키마가 정말 일치하는지 확인한다. 0이 아니면 배포를 멈추고 drift부터 해소한다.

## 알려진 부채 — drizzle-kit migrate 미작동 (정상화 defer)

`drizzle-kit migrate`가 **0000 baseline SQL 누락 + 프로덕션 `__drizzle_migrations` 추적 테이블 부재**로 작동하지 않아, 위 수동 `apply-*.cjs` 절차가 유일한 적용 경로다.

정상화(0000 baseline 복원 + `__drizzle_migrations`에 기존 마이그레이션 해시 시드)는 검토 후 **defer 결정**. 사유:

- 수동 `apply-*.cjs` 절차가 안정적으로 동작 중이고 위 런북으로 문서화됨.
- 시드할 해시가 drizzle 계산값과 어긋나면 migrate가 기존 마이그레이션을 **재실행**해 "이미 존재하는 테이블" 에러를 낼 위험이 있음.

향후 정상화가 필요해지면 **부팅 시 자동 migrate가 아니라 수동 `drizzle-kit migrate` 표준화(방식 a)**로 진행한다 — 부팅-자동은 migrate 실패 시 앱이 아예 안 뜨는 가용성 위험이 실이익보다 크다.
