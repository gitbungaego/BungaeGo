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

| # | tag | 내용 | 프로덕션 |
|---|-----|------|:---:|
| 0001–0009 | (초기) | 기본 스키마(users, events, trips, reservations, payments, ride_requests, clusters, stop_candidates, rally_point_candidates 등) | 적용됨 |
| 0010 | parallel_the_phantom | payments: `reservationId` nullable화, `method` enum에 `toss`, `orderId`(unique)/`tossPaymentKey`/`orderContext` 추가 | 적용됨 |
| 0011 | solid_molten_man | payments: `rideRequestId`, `refundedAmount` + 인덱스 | 적용됨 |
| 0012 | curved_jimmy_woo | events: `matchingFrozenBy` enum('admin','auto') | 적용됨 |
| 0013 | bumpy_genesis | `event_likes` 테이블 (UNIQUE(eventId,userId)) | 적용됨 |
| 0014 | loose_black_panther | events: `searchAliases`, `tags` (검색 별칭/태그) | 적용됨 |

프로덕션 DB: **TiDB Cloud `test`** (`gateway01.ap-northeast-1.prod.aws.tidbcloud.com`).

## 알려진 부채

`drizzle-kit migrate`가 0000 baseline 누락 + `__drizzle_migrations` 부재로 작동하지 않아, 위 수동 `apply-*.cjs` 절차가 유일한 적용 경로다. 마이그레이션 체계 정상화(자동화) 검토는 별도 이슈로 진행한다.
