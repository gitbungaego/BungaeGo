# 번개GO 레퍼럴·크레딧 시스템 스펙 (referral-credit-spec.md)

> Claude Code 구현용 스펙 문서. 랠리 라이프사이클(`rally-lifecycle-spec.md`)과 연동됨.
> 스택: React 19 + Vite 7 + tRPC 11 + Express + Drizzle ORM + MySQL(TiDB Cloud)

---

## 1. 개요

- 모든 회원은 가입 시 **고유 추천 코드**를 자동 발급받는다.
- **아이허브식 주문 단위 모델**: 가입 시 영구 귀속이 아니라, **매 결제(탑승 신청)마다 결제 화면에서 추천 코드를 입력**한다.
- 코드를 입력한 결제 건이 속한 랠리가 `COMPLETED`에 도달하면, **코드 주인(추천인)에게 크레딧이 지급된다. 횟수 제한 없음(첫 탑승 한정 아님).**
- 추천인은 본인이 탑승하지 않아도 코드를 홍보하여 크레딧을 적립할 수 있다.
- 크레딧은 **분담금 결제 차감 전용**이며 현금 인출은 불가하다.

## 2. 용어

| 용어 | 정의 |
|---|---|
| 추천인 (referrer) | 코드의 주인. 결제 건에 입력된 코드의 소유자 |
| 결제자 (payer) | 결제 시 코드를 입력한 탑승 신청자 (신규/기존 회원 무관) |
| 추천 건 (referral entry) | 결제 1건에 코드 1개가 입력된 기록. 주문 단위 |
| 적립 확정 | 해당 결제 건의 랠리가 COMPLETED 상태에 도달한 시점 |
| 크레딧 | 플랫폼 내 적립금 (KRW 정수, 원 단위) |

## 3. 추천 코드 & 입력 구조

### 3.1 코드 발급
- 가입 시 자동 발급. 형식: 영문 대문자 + 숫자 6~8자 (예: `YUDAM7X2`)
- 유저당 1개, 변경 불가. `users.referral_code` UNIQUE 컬럼.
- 생성 시 충돌 검사 후 재시도 (최대 5회).

### 3.2 공유 링크
- 형식: `https://bungaego.com/rally/{rallyId}?ref={referralCode}`
- `ref` 파라미터는 **가입 귀속용이 아니라 결제 화면 코드 입력란의 프리필(prefill)용**이다.
  - 클라이언트는 `ref` 값을 세션에 보관했다가 결제 화면 진입 시 입력란에 자동 채움. 결제자는 지우거나 다른 코드로 교체 가능.
- 링크 없이 결제 화면에서 직접 코드를 입력하는 것도 동일하게 유효하다.

### 3.3 입력 규칙 (결제 단위)
- 결제 화면에 추천 코드 입력란 제공. **입력은 선택사항.**
- 결제 1건당 코드 1개만 입력 가능.
- 검증 (결제 요청 시 서버에서):
  1. 존재하는 코드인가
  2. **본인 코드가 아닌가** (`code.owner != payer`) — 셀프 입력 거부
  3. 코드 주인 계정이 활성 상태인가
- 결제 완료 후 코드 변경/추가 불가.
- 신규·기존 회원 구분 없이 누구나 입력 가능 (아이허브와 동일).

## 4. 크레딧 적립 규칙

### 4.1 적립 조건 (모두 충족 시)
1. 결제 건에 유효한 추천 코드가 입력되어 있을 것
2. 해당 결제가 정상 완료(자동결제 성공)되고 취소/환불되지 않았을 것
3. 해당 랠리가 `COMPLETED` 상태에 도달할 것

### 4.2 적립 금액 (이원 요율)
- 기준액: **결제자 실결제액(크레딧 차감 후 실제 수금액)**, 원 단위 내림 (`Math.floor`), **상한 5,000원** 공통
- 요율은 추천인의 **동일 행사 참가 여부**로 결정:
  - **참가자 요율 5%**: 추천인이 해당 랠리와 동일한 `event_id`의 랠리(노선 무관)에 **결제 완료 상태**인 경우
  - **기본 요율 2%**: 그 외 (비참가 홍보자)
- **판정 시점 = 추천 건 생성(결제) 시점 스냅샷.** `referral_entries.applied_rate`에 저장하고 이후 재판정하지 않는다.
  - 추천인이 나중에 자기 탑승을 취소하거나 추천인의 랠리가 FAILED 되어도 이미 생성된 건의 요율은 유지 (단순성 우선).
- 예: 실결제액 43,000원 → 참가자 2,150원 / 비참가자 860원. 실결제액 120,000원 → 참가자 5,000원(캡) / 비참가자 2,400원.
- 목적: 동일 행사 참가자가 자기 노선 외 **타 지역 노선까지 교차 홍보**하도록 유도하면서, 외부 홍보 채널(팬카페·정보계정)도 유지.

### 4.3 지급 시점
- 랠리 상태가 `COMPLETED`로 전이되는 이벤트 핸들러에서, 해당 랠리의 모든 유효 추천 건을 일괄 지급.
- `RECRUITING`/`CONFIRMED` 단계에서는 어떤 크레딧도 지급하지 않는다 → 취소 회수 로직 불필요.
- 지급 시 `credit_transactions`에 `EARN_REFERRAL` 트랜잭션 기록 + 추천인에게 알림 발송.

### 4.4 미지급 케이스 (해당 추천 건 `VOID` 처리)
- 랠리 `FAILED` / `CANCELED` → 해당 랠리의 추천 건 전부 `VOID`. 지급 없음.
- 결제자가 D-7 이전 자진 취소 → 해당 추천 건 `VOID`.
- 결제자/추천인 계정 정지·탈퇴 → `VOID`.
- 주문 단위 모델이므로 `VOID`는 그 건에만 적용된다. 같은 코드가 다른 결제 건에 입력되는 것에는 영향 없음.

## 5. 크레딧 사용 규칙

- 사용처: **랠리 분담금 결제 시 차감 전용**. 현금 인출·타인 양도 불가.
- 결제 흐름: `최종 결제액 = 분담금 - min(보유 크레딧, 분담금, 사용자 지정액)`
- 크레딧으로 분담금 100% 차감 가능 (0원 결제 허용, 빌링키 등록은 여전히 필수).
- **확정 판정은 실결제액(크레딧 차감 후 실제 수금액) 합계 기준이다.** 크레딧 차감분은 목표 대절비 달성 계산에 포함하지 않는다. 즉 `확정 조건 = Σ(실결제액) ≥ 목표 대절비 AND 인원 ≤ 정원`. 손해 운행 원천 차단.
  - 예: 분담금 40,000원에서 크레딧 5,000원 사용 → 목표액 기여분은 35,000원.
  - UI에 "크레딧 사용 시 랠리 확정에 반영되는 금액이 줄어듭니다" 안내 문구 표시.
- 사용 시점: 결제 시 즉시 차감(`SPEND` 트랜잭션). 랠리 `FAILED`/`CANCELED` 또는 D-7 이전 취소 시 **크레딧 원복**(`REFUND` 트랜잭션, 만료일은 원래 만료일 유지 — 리셋 아님).

## 6. 만료 정책

- 유효기간: **적립일로부터 365일**
- **전체 리셋 방식**: 새 크레딧 적립 이벤트 발생 시, 해당 유저의 `credit_expires_at`을 `NOW() + 365일`로 갱신 (보유 잔액 전체에 적용)
  - 유저당 만료일 1개만 관리. 크레딧 건별 만료일 없음.
  - 사용(`SPEND`)·원복(`REFUND`)은 리셋 트리거가 아님. 적립(`EARN_*`)만 리셋.
- 만료 처리: 일 1회 배치. `credit_expires_at < NOW()`인 유저의 잔액 전체를 `EXPIRE` 트랜잭션으로 0 처리.
- **만료 30일 전 / 7일 전 알림** (AlimTalk): "크레딧 N원이 M월 D일 소멸 예정"

## 7. 어뷰징 방지

1. **셀프 입력 차단**: 결제 검증 시 본인 코드 거부 (3.3)
2. **동일성 검사**: 결제자와 코드 주인이 다음 항목에서 일치하면 해당 추천 건 `FLAGGED` (지급 보류, 관리자 검토):
   - 빌링키 카드 지문 동일 (bin+last4 해시 비교)
   - 동일 휴대폰 번호
3. **지급 조건 자체가 방어선**: 실결제 + 랠리 COMPLETED가 요구되므로 무비용 어뷰징 불가. 어뷰징 비용(실제 탑승비) > 크레딧(최대 5,000원).
4. **속도 제한**: 동일 코드 기준 일일 신규 입력 20건 초과 시 초과분 `FLAGGED`.
5. **교차 입력 모니터링**: 두 유저가 서로의 코드를 반복 입력하는 패턴(사실상 상호 5% 할인)은 파일럿에서는 허용하되 관리자 대시보드에 집계 노출. 비용이 과도해지면 `reward_config`의 rate 조정으로 대응.
6. 관리자 페이지에 `FLAGGED` 추천 건 목록 + 승인/거부 액션 제공.

## 8. DB 스키마 (Drizzle)

```ts
// users 테이블에 컬럼 추가
referralCode: varchar('referral_code', { length: 12 }).unique().notNull(),
creditBalance: int('credit_balance').notNull().default(0),        // 캐시된 잔액 (원)
creditExpiresAt: datetime('credit_expires_at'),                    // 전체 리셋 방식 만료일

// 추천 건 (결제 단위)
export const referralEntries = mysqlTable('referral_entries', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  rallyId: bigint('rally_id', { mode: 'number' }).notNull(),
  paymentId: bigint('payment_id', { mode: 'number' }).notNull().unique(), // 결제 1건당 코드 1개
  payerUserId: bigint('payer_user_id', { mode: 'number' }).notNull(),
  referrerUserId: bigint('referrer_user_id', { mode: 'number' }).notNull(),
  code: varchar('code', { length: 12 }).notNull(),
  source: mysqlEnum('source', ['LINK_PREFILL', 'MANUAL']).notNull(),
  appliedRate: decimal('applied_rate', { precision: 4, scale: 3 }).notNull(), // 생성 시점 스냅샷 (0.050 / 0.020)
  referrerIsParticipant: boolean('referrer_is_participant').notNull(),        // 판정 근거 기록
  status: mysqlEnum('status', ['PENDING', 'COMPLETED', 'FLAGGED', 'REJECTED', 'VOID']).notNull().default('PENDING'),
  rewardAmount: int('reward_amount'),               // 지급 시 확정 금액
  rewardTransactionId: bigint('reward_transaction_id', { mode: 'number' }),
  createdAt: datetime('created_at').notNull(),
  completedAt: datetime('completed_at'),
}, (t) => [
  index('idx_re_rally').on(t.rallyId),
  index('idx_re_referrer').on(t.referrerUserId),
]);

// 크레딧 원장 (append-only)
export const creditTransactions = mysqlTable('credit_transactions', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  type: mysqlEnum('type', ['EARN_REFERRAL', 'EARN_PROMO', 'SPEND', 'REFUND', 'EXPIRE', 'ADMIN_ADJUST']).notNull(),
  amount: int('amount').notNull(),          // EARN/REFUND 양수, SPEND/EXPIRE 음수
  balanceAfter: int('balance_after').notNull(),
  relatedRallyId: bigint('related_rally_id', { mode: 'number' }),
  relatedReferralEntryId: bigint('related_referral_entry_id', { mode: 'number' }),
  memo: varchar('memo', { length: 255 }),
  createdAt: datetime('created_at').notNull(),
});

// 정책 설정 (하드코딩 금지)
export const rewardConfig = mysqlTable('reward_config', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: varchar('value', { length: 255 }).notNull(),
});
// 초기값:
// referral_rate_participant = 0.05   // 동일 행사 참가자
// referral_rate_default = 0.02       // 비참가 홍보자
// referral_cap_krw = 5000            // 요율 무관 공통 상한
// credit_ttl_days = 365
// expiry_notice_days = 30,7
// daily_code_entry_limit = 20
```

- 잔액은 `credit_transactions` 합계가 진실 원천(source of truth). `users.creditBalance`는 캐시이며 트랜잭션 내에서 동시 갱신 (`SELECT ... FOR UPDATE`).

## 9. 이벤트 흐름

```
[결제 요청] --코드 입력 시--> 서버 검증(존재·셀프금지·활성)
    ├─ 참가 여부 판정: 추천인이 동일 event_id 랠리에 결제 완료 상태인가
    ├─ applied_rate 스냅샷 (0.05 / 0.02) 저장
    └─ referral_entries(PENDING) 생성 + 어뷰징 검사(FLAGGED 가능)
[결제자 D-7 이전 자진 취소] --> 해당 entry VOID + 크레딧 사용분 REFUND
[랠리 COMPLETED 전이 핸들러]
    ├─ 해당 랠리의 referral_entries WHERE status=PENDING 조회
    ├─ 적립액 = floor(실결제액 × entry.applied_rate), cap 적용
    ├─ credit_transactions EARN_REFERRAL 기록 + balance/expires_at 갱신
    ├─ entry.status = COMPLETED, rewardAmount 기록
    └─ 추천인에게 AlimTalk 알림
[랠리 FAILED/CANCELED] --> 해당 랠리의 PENDING entry 전부 VOID + 크레딧 사용분 REFUND 원복
[일 배치] --> 만료 알림(D-30, D-7) 발송 / 만료 잔액 EXPIRE 처리
```

## 10. tRPC 라우터 (초안)

```
referral.getMyCode          // 내 코드 + 공유 링크 생성
referral.validateCode       // 결제 화면 코드 입력 시 실시간 검증 (존재·셀프 여부)
referral.getMyStats         // 입력된 건수, PENDING/COMPLETED/VOID 수, 누적 적립액
credit.getBalance           // 잔액 + 만료 예정일
credit.getTransactions      // 원장 페이지네이션
credit.applyToPayment       // 결제 시 차감액 검증 (서버 재계산 필수)
admin.referral.listFlagged  // FLAGGED 목록
admin.referral.resolve      // 승인/거부
admin.referral.crossUsage   // 교차 입력 패턴 집계 (7.5)
```

## 11. 비범위 (v2 이연)

- 현금 인출 (Hyperwallet 류) — 세무·전자금융 검토 후
- 결제자 측 즉시 할인 (양방향 인센티브) — 정책 확정 시 `EARN_PROMO`로 확장
- 크레딧 선불전자지급수단 해당 여부 법률 검토 (총 발행 규모가 커지기 전 확인)

## 12. 테스트 시나리오 체크리스트

1. 코드 입력 결제 → 랠리 COMPLETED → 실결제액 × 스냅샷 요율 적립 (내림, 캡) 확인
2. 참가자 판정: 추천인이 동일 event_id 타 노선 랠리에 결제 완료 → 5% 적용 / 미참가 → 2% 적용
3. 스냅샷 유지: 추천 건 생성 후 추천인이 자기 탑승 취소 → 요율 5% 그대로 지급 확인
4. 실결제액 120,000원 → 참가자 5,000원 캡 / 비참가자 2,400원
5. 랠리 FAILED → 해당 랠리 entry 전부 VOID, 지급 없음. 같은 코드의 타 랠리 entry는 영향 없음
6. 결제자 D-7 이전 자진 취소 → 해당 entry VOID + 크레딧 원복(만료일 리셋 안 됨)
7. 동일 결제자가 다음 랠리에서 같은 코드 재입력 → 재적립 확인 (횟수 제한 없음)
8. 본인 코드 입력 → 결제 단계에서 거부
9. 새 적립 발생 → creditExpiresAt이 NOW+365d로 갱신, 기존 잔액 포함 확인
10. 만료 배치 → EXPIRE 트랜잭션 + 잔액 0
11. 동일 카드 지문 / 동일 전화번호 → FLAGGED, 지급 보류
12. 크레딧 100% 차감 0원 결제 → 빌링키 등록 요구 유지 + 확정 목표액 기여 0원 확인
13. 크레딧 사용 결제의 목표액 기여분 = 실결제액만 반영 확인
14. 동시 결제 2건에서 잔액 이중 사용 방지 (FOR UPDATE 검증)
