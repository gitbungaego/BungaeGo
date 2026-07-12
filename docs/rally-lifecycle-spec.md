# 번개GO 랠리 라이프사이클 — 상태 머신 + DB 스키마 스펙 v1

> 대상: Claude Code 구현용 스펙. 기존 스택(React 19 + tRPC 11 + Express + Drizzle ORM + MySQL/TiDB Cloud + Toss Payments) 기준.
> 반영된 제품 결정: 동 단위 수요 입력 / 후보 정류장 선노출 / 빌링키 약정 + 확정 시 자동결제(약정액·실결제액 분리) /
> 금액제 확정(목표 대절비 달성 AND 정원 이내) / D-8 배정 고지 → D-7 확정 / 확정 시 3중 동결(정류장·경로·요금) /
> 확정 후 재계산 없음(대기자·양도로 보충) / 부스트·양도 자동화·취소 수수료는 v2로 이연.

---

## 0. 용어

| 용어 | 정의 |
|---|---|
| **랠리(rally)** | 특정 행사 × 출발 권역 × 방향(행사행/귀가/왕복) 단위의 공동 대절 모집 건 |
| **약정(pledge)** | 참여자가 "최대 N원까지 분담"에 동의하고 빌링키를 등록한 상태. 이 시점에 결제 없음 |
| **목표금액(goal)** | 해당 랠리의 대절비 목표. `charterPriceEstimator` 상단 밴드 + 마진으로 산정 |
| **확정(confirm)** | D-7 판정 통과 → 스냅샷 생성 + 일괄 자동결제. 이후 정류장·경로·요금 불변 |
| **스냅샷(snapshot)** | 확정 시점의 정류장·경로·요금·배정의 불변 레코드. 확정 후 모든 화면/알림/정산의 유일한 참조원 |

타임라인 기준점 (출발일 = D-0):

```
개설 ──────────── D-8 ──────── D-7 ──────────── D-0
   RECRUITING      NOTICE      CONFIRMED/FAILED   운행
   (모집·잠정배정)  (배정고지·    (스냅샷+결제)
                   이의/이탈)
```

---

## 1. 랠리 상태 머신

### 1.1 상태 정의

```
RECRUITING → NOTICE → CONFIRMED → COMPLETED
                 │          │
                 ▼          ▼
               FAILED    CANCELED
```

| 상태 | 의미 | 진입 조건 | 이 상태에서 허용되는 것 |
|---|---|---|---|
| `RECRUITING` | 모집 중 | 랠리 생성 | 약정 접수(동 단위), 자유 이탈(무비용), 야간 배치 잠정 배정 재계산 |
| `NOTICE` | 배정 고지·이의 기간 (D-8 → D-7) | D-8 00:00 배치 | 최종 배정안 산출(저인원 정류장 병합 포함) 후 고지, 무료 이탈, **신규 약정은 산출된 정류장 중 선택 방식으로만**(경로 불변 원칙) |
| `CONFIRMED` | 확정 | D-7 판정 통과: `모금액충족 AND 인원 ≤ 정원` | 스냅샷 생성 → 일괄 결제 → 결제 실패 리트라이(24h) → 대기 승격(수동). 정류장·경로·요금 변경 금지 |
| `FAILED` | 목표 미달 무산 | D-7 판정 실패 | 결제 없음. 약정 해제 알림 발송. 종결 상태 |
| `COMPLETED` | 운행 완료 | 운행일 종료 배치 또는 운영자 처리 | 탑승/노쇼 기록 마감. 종결 상태 |
| `CANCELED` | 취소 | 운영자 액션(불가항력, 버스사 펑크 등) | CONFIRMED 이후였다면 전액 환불 트리거. 종결 상태 |

### 1.2 전이 표 (guard / side effect)

| # | 전이 | 트리거 | Guard | Side effects |
|---|---|---|---|---|
| T1 | `RECRUITING → NOTICE` | D-8 00:00 크론 | — | ① 최종 배정 실행(§3) ② 저인원 정류장 병합 ③ `assignment_runs` 기록 ④ 참여자 전원에게 배정 고지 알림톡(병합 대상자에겐 "탑승지 조정 + 무료 이탈 가능" 문구) |
| T2 | `NOTICE → CONFIRMED` | D-7 00:00 크론 | `activePledgeSum ≥ goalAmount` AND `activeCount ≤ maxSeats` | ① `rally_snapshots` INSERT(§4.7) ② 1인 분담금 계산(§5) ③ 전원 빌링키 일괄 결제 큐잉 ④ 확정 알림톡("약정 X원 → 실결제 Y원") |
| T3 | `NOTICE → FAILED` | D-7 00:00 크론 | T2 guard 불충족 | ① 결제 없음 ② 무산 알림톡 ③ 약정 status → `RELEASED` |
| T4 | `CONFIRMED → COMPLETED` | 운행일 D+1 크론 또는 운영자 | — | 참여자 status → `BOARDED`/`NO_SHOW` 마감 |
| T5 | `* → CANCELED` | 운영자 수동 | — | CONFIRMED였다면 `CHARGED` 전원 환불 큐잉, 취소 사유 기록 |

**불가역 규칙**: `CONFIRMED`, `FAILED`, `COMPLETED`, `CANCELED`에서 이전 상태로 돌아가는 전이는 존재하지 않는다. 상태 전이는 반드시 단일 트랜잭션 + 상태 컬럼 조건부 UPDATE(`WHERE status = :expected`)로 구현해 크론 중복 실행에 대비한다(멱등성).

---

## 2. 참여(약정) 상태 머신

`rally_demands.status`:

```
PLEDGED ──(확정 전 이탈)──► WITHDRAWN                    [종결]
PLEDGED ──(랠리 FAILED)──► RELEASED                      [종결]
PLEDGED ──(확정 결제 성공)──► CHARGED
PLEDGED ──(확정 결제 실패)──► PAYMENT_FAILED ──(리트라이 성공)──► CHARGED
                                    └──(24h 내 실패 확정)──► REVOKED   [종결, 자리 해제]
CHARGED ──(랠리 CANCELED / 운영자 환불)──► REFUNDED       [종결]
CHARGED ──(운행일)──► BOARDED | NO_SHOW                   [종결]
```

| 상태 | 의미 |
|---|---|
| `PLEDGED` | 약정 완료(빌링키 연결). 결제 전 |
| `WITHDRAWN` | 확정 전 자발적 이탈. 무비용 |
| `RELEASED` | 랠리 무산으로 약정 자동 해제. 무비용 |
| `CHARGED` | 확정 결제 완료. `chargedAmountKrw` 기록 |
| `PAYMENT_FAILED` | 확정 결제 실패, 24h 리트라이 윈도우 진행 중 |
| `REVOKED` | 결제 실패 확정. 자리 해제(대기 승격 대상 슬롯) |
| `REFUNDED` | 결제 후 환불 완료 |
| `BOARDED` / `NO_SHOW` | 운행일 탑승 결과 |

v2 예약 상태(스키마 enum에 미리 포함만): `TRANSFERRED`(양도).

**참여자 관점 보장(제품 약속과 1:1 대응)**
- `PLEDGED` 동안 돈은 절대 나가지 않는다.
- `chargedAmountKrw ≤ pledgeAmountKrw` 를 코드 레벨 assert로 강제한다.
- `CONFIRMED` 이후 다른 참여자의 이탈/REVOKED가 나의 요금을 올리지 않는다(요금 동결 — 마진이 흡수, §5).

---

## 3. 배정(assignment) 규칙

### 3.1 모집 중 잠정 배정 (RECRUITING)
- 입력: 랠리별 `(dongCode, activeCount)` 집계 + `dong_stop_candidates`의 검증 정류장 후보 풀.
- 실행: 야간 배치 1회/일. 즉시 재계산 트리거는 두지 않는다(파일럿 규모에서 불필요 — v2에서 ±20% 변동 트리거 검토).
- 출력: `rally_demands.provisionalStopId` 갱신 + `assignment_runs` 1행.
- UI 노출: "현재 예상 탑승지" + "탑승지는 D-8에 최종 안내됩니다" 고정 문구.

### 3.2 최종 배정 (T1, D-8)
1. 동별 집계 → 기존 DBSCAN/geo-median 파이프라인의 입력을 **동 중심점 × 인원 가중치**로 구성.
2. 정류장 스냅은 반드시 `boarding_stops`(로드뷰 검증 완료 풀) 안에서만.
3. **저인원 병합**: 배정 인원 < `MIN_PER_STOP`(기본 3)인 정류장은 경로상 인접 정류장으로 병합. 병합 대상자 목록을 T1 side effect의 "조정 고지" 대상으로 반환.
4. 결과를 `rally_demands.finalStopId`(아직 스냅샷 아님 — NOTICE 기간 이탈 반영 가능)와 `assignment_runs`에 기록.
5. `assignment_runs.inputSummary / outputSummary / algoVersion` 은 **배차 산정기준 투명성(여객자동차법 49조의20 제2호) 대응 기록**을 겸한다. 삭제 금지.

### 3.3 확정 후 (CONFIRMED)
- 재계산 없음. 경로·정류장은 `rally_snapshots`만 참조.
- REVOKED로 빈 자리의 보충(대기 승격)은 파일럿에서 운영자 수동 처리. 승격자는 **스냅샷에 존재하는 정류장 중 선택**만 가능.

---

## 4. DB 스키마 (Drizzle / MySQL·TiDB)

> 기존 7개 테이블과의 이름 충돌은 구현 시 조정. 아래는 신규/변경분. `snake_case` 컬럼, KRW 정수(원 단위), UTC datetime.

### 4.1 rallies

```ts
export const rallies = mysqlTable('rallies', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  // 행사 정보 (파일럿: 인라인. v2에서 events 테이블 분리 검토)
  eventName: varchar('event_name', { length: 200 }).notNull(),
  venueName: varchar('venue_name', { length: 200 }).notNull(),
  venueLat: double('venue_lat').notNull(),
  venueLng: double('venue_lng').notNull(),
  eventStartAt: datetime('event_start_at').notNull(),

  // 모집 정의
  originRegion: varchar('origin_region', { length: 50 }).notNull(),      // 예: '울산'
  direction: mysqlEnum('direction', ['TO_EVENT', 'FROM_EVENT', 'ROUND_TRIP']).notNull(),
  creatorUserId: bigint('creator_user_id', { mode: 'number' }).notNull(), // 개설자 = 여객대표

  // 금액제 확정 파라미터
  goalAmountKrw: int('goal_amount_krw').notNull(),        // 대절비 목표 (estimator 상단밴드 + 마진)
  pledgeCapKrw: int('pledge_cap_krw').notNull(),          // 1인 최대 약정액 (화면 표시가)
  maxSeats: smallint('max_seats').notNull(),              // 차량 정원 상한
  vehicleType: varchar('vehicle_type', { length: 30 }).notNull(), // '45_STANDARD' | '28_PREMIUM' 등
  minPerStop: smallint('min_per_stop').notNull().default(3),

  // 타임라인
  departAt: datetime('depart_at').notNull(),              // D-0 출발 시각
  noticeAt: datetime('notice_at').notNull(),              // D-8 00:00
  confirmDeadlineAt: datetime('confirm_deadline_at').notNull(), // D-7 00:00

  status: mysqlEnum('status', [
    'RECRUITING', 'NOTICE', 'CONFIRMED', 'FAILED', 'COMPLETED', 'CANCELED',
  ]).notNull().default('RECRUITING'),
  canceledReason: varchar('canceled_reason', { length: 500 }),

  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
}, (t) => [
  index('idx_rallies_status_confirm').on(t.status, t.confirmDeadlineAt),
  index('idx_rallies_status_notice').on(t.status, t.noticeAt),
]);
```

### 4.2 boarding_stops (기존 스캐폴딩 확장 — 검증 정류장 풀)

```ts
export const boardingStops = mysqlTable('boarding_stops', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  lat: double('lat').notNull(),
  lng: double('lng').notNull(),
  region: varchar('region', { length: 50 }).notNull(),
  roadviewVerifiedAt: datetime('roadview_verified_at'),   // null = 미검증(배정 제외)
  note: varchar('note', { length: 500 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: datetime('created_at').notNull(),
});
```

### 4.3 dong_stop_candidates (동 → 후보 정류장 매핑, 후보 선노출용)

```ts
export const dongStopCandidates = mysqlTable('dong_stop_candidates', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  dongCode: varchar('dong_code', { length: 10 }).notNull(),   // 법정동 코드 (행정표준코드)
  dongName: varchar('dong_name', { length: 50 }).notNull(),   // '우정동'
  stopId: bigint('stop_id', { mode: 'number' }).notNull().references(() => boardingStops.id),
  priority: smallint('priority').notNull().default(0),        // 노출·배정 우선순위
}, (t) => [
  uniqueIndex('uq_dong_stop').on(t.dongCode, t.stopId),
  index('idx_dong').on(t.dongCode),
]);
```

> 신청 화면: 사용자가 동 입력 → 이 테이블로 후보 정류장 즉시 노출("탑승지는 다음 중 한 곳으로 배정됩니다").

### 4.4 billing_keys

```ts
export const billingKeys = mysqlTable('billing_keys', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  tossCustomerKey: varchar('toss_customer_key', { length: 100 }).notNull(), // 유저당 고정 발급
  tossBillingKey: varchar('toss_billing_key', { length: 200 }).notNull(),   // 암호화 저장 (AES, KMS 검토)
  cardCompany: varchar('card_company', { length: 30 }),
  cardNumberMasked: varchar('card_number_masked', { length: 25 }),
  status: mysqlEnum('status', ['ACTIVE', 'REMOVED']).notNull().default('ACTIVE'),
  createdAt: datetime('created_at').notNull(),
}, (t) => [index('idx_bk_user').on(t.userId, t.status)]);
```

### 4.5 rally_demands (약정)

```ts
export const rallyDemands = mysqlTable('rally_demands', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  rallyId: bigint('rally_id', { mode: 'number' }).notNull().references(() => rallies.id),
  userId: bigint('user_id', { mode: 'number' }).notNull(),

  dongCode: varchar('dong_code', { length: 10 }).notNull(),
  dongName: varchar('dong_name', { length: 50 }).notNull(),
  pledgeAmountKrw: int('pledge_amount_krw').notNull(),    // MVP: rally.pledgeCapKrw 복사
  billingKeyId: bigint('billing_key_id', { mode: 'number' }).notNull().references(() => billingKeys.id),

  provisionalStopId: bigint('provisional_stop_id', { mode: 'number' }), // 모집 중 잠정
  finalStopId: bigint('final_stop_id', { mode: 'number' }),             // D-8 최종 배정

  status: mysqlEnum('status', [
    'PLEDGED', 'WITHDRAWN', 'RELEASED',
    'CHARGED', 'PAYMENT_FAILED', 'REVOKED', 'REFUNDED',
    'BOARDED', 'NO_SHOW', 'TRANSFERRED', // TRANSFERRED = v2 예약
  ]).notNull().default('PLEDGED'),
  chargedAmountKrw: int('charged_amount_krw'),
  statusChangedAt: datetime('status_changed_at').notNull(),

  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_rally_user').on(t.rallyId, t.userId),   // 랠리당 1약정
  index('idx_demand_rally_status').on(t.rallyId, t.status),
]);
```

집계 편의 뷰(또는 쿼리 헬퍼): `activePledges(rallyId)` = status IN ('PLEDGED') / 확정 후 유효 인원 = status IN ('CHARGED','PAYMENT_FAILED').

### 4.6 assignment_runs (배정 실행 기록 — 투명성 의무 대응 겸용)

```ts
export const assignmentRuns = mysqlTable('assignment_runs', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  rallyId: bigint('rally_id', { mode: 'number' }).notNull(),
  trigger: mysqlEnum('trigger', ['NIGHTLY', 'FINAL_D8', 'MANUAL']).notNull(),
  algoVersion: varchar('algo_version', { length: 20 }).notNull(),
  inputSummary: json('input_summary').notNull(),   // [{dongCode, count}]
  outputSummary: json('output_summary').notNull(), // [{stopId, assignedCount, mergedFrom?: stopId[]}]
  ranAt: datetime('ran_at').notNull(),
}, (t) => [index('idx_run_rally').on(t.rallyId, t.ranAt)]);
```

### 4.7 rally_snapshots (확정 스냅샷 — 불변)

```ts
export const rallySnapshots = mysqlTable('rally_snapshots', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  rallyId: bigint('rally_id', { mode: 'number' }).notNull().references(() => rallies.id),
  assignmentRunId: bigint('assignment_run_id', { mode: 'number' }).notNull(),
  confirmedAt: datetime('confirmed_at').notNull(),

  // 3중 동결 대상
  stopsJson: json('stops_json').notNull(),
  // [{order, stopId, name, lat, lng, plannedArrivalAt, participantDemandIds: number[]}]
  routeJson: json('route_json').notNull(),          // polyline / legs / 총거리·소요시간
  perPersonFareKrw: int('per_person_fare_krw').notNull(),

  // 판정 근거 기록
  goalAmountKrw: int('goal_amount_krw').notNull(),
  participantCount: smallint('participant_count').notNull(),
  pledgeSumKrw: int('pledge_sum_krw').notNull(),

  // 운영 정보 (확정 후 버스사 계약 시 채움 — 스냅샷 중 유일하게 UPDATE 허용되는 컬럼)
  operatorId: bigint('operator_id', { mode: 'number' }),
  operatorQuoteKrw: int('operator_quote_krw'),
}, (t) => [uniqueIndex('uq_snapshot_rally').on(t.rallyId)]);
```

**불변 규칙 (앱 레벨 강제)**: `stopsJson / routeJson / perPersonFareKrw` 는 INSERT 이후 UPDATE 금지. tRPC 레이어에 update 경로 자체를 만들지 않는다. `CONFIRMED` 이후의 모든 조회(화면·알림·정산)는 rallies/rally_demands의 라이브 값이 아니라 이 테이블을 읽는다.

### 4.8 payment_attempts

```ts
export const paymentAttempts = mysqlTable('payment_attempts', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  demandId: bigint('demand_id', { mode: 'number' }).notNull().references(() => rallyDemands.id),
  snapshotId: bigint('snapshot_id', { mode: 'number' }).notNull(),
  attemptNo: smallint('attempt_no').notNull(),            // 1 = 확정 즉시, 2+ = 리트라이
  amountKrw: int('amount_krw').notNull(),
  orderId: varchar('order_id', { length: 64 }).notNull(), // 멱등키: `rally{R}-demand{D}-try{N}`
  tossPaymentKey: varchar('toss_payment_key', { length: 200 }),
  status: mysqlEnum('status', ['REQUESTED', 'APPROVED', 'FAILED', 'REFUNDED']).notNull(),
  failCode: varchar('fail_code', { length: 50 }),
  failMessage: varchar('fail_message', { length: 300 }),
  requestedAt: datetime('requested_at').notNull(),
  resolvedAt: datetime('resolved_at'),
}, (t) => [
  uniqueIndex('uq_order').on(t.orderId),                  // 중복 청구 방지
  index('idx_pay_demand').on(t.demandId),
]);
```

---

## 5. 요금·판정 공식

```
확정 조건 (D-7):
  activeCount = COUNT(demands WHERE status='PLEDGED')
  pledgeSum   = SUM(pledgeAmountKrw)          // MVP에선 = activeCount × pledgeCapKrw
  통과 ⇔ pledgeSum ≥ goalAmountKrw AND activeCount ≤ maxSeats

1인 분담금 (확정 시 1회 계산 후 동결):
  perPersonFare = min( pledgeCapKrw,
                       ceil( goalAmountKrw / activeCount / 100 ) * 100 )  // 100원 단위 올림

결제:
  각 참여자 청구액 = perPersonFare  (항상 ≤ pledgeAmount — assert)
```

- **결제 실패 흡수**: 실패자 발생으로 실수령이 goal 밑으로 내려가는 리스크는 goal 자체의 마진(estimator 상단 밴드 + 마진율, 별도 스펙 ③)이 흡수한다. **남은 참여자에게 재분배(요금 인상)는 어떤 경우에도 하지 않는다.**
- goal 산정 공식과 마진율은 스펙 ③(목표금액 산정)에서 다룸. 이 문서에서는 `goalAmountKrw`를 입력값으로 취급.

---

## 6. 배치 잡 (스케줄러)

| 잡 | 주기 | 대상 | 동작 |
|---|---|---|---|
| `nightlyAssign` | 매일 03:00 | status=RECRUITING | §3.1 잠정 배정. 실패해도 서비스 무영향(잠정값일 뿐) |
| `noticeTransition` | 매일 00:05 | RECRUITING AND noticeAt ≤ now | T1 실행 (최종 배정 → 병합 → 고지) |
| `confirmTransition` | 매일 00:10 | NOTICE AND confirmDeadlineAt ≤ now | T2/T3 판정. CONFIRMED면 스냅샷 → 결제 큐잉 |
| `chargeWorker` | 큐 소비 | PLEDGED (스냅샷 확정분) | 토스 빌링 승인 API 호출. 성공→CHARGED / 실패→PAYMENT_FAILED + 실패 알림톡("24시간 내 카드 확인") |
| `chargeRetry` | 1시간마다 | PAYMENT_FAILED AND 최초실패 < 24h | 재시도(attemptNo 증가). 24h 초과 시 REVOKED 확정 + 알림 |
| `completeTransition` | 매일 12:00 | CONFIRMED AND departAt < now-12h | T4 |

공통 구현 규칙:
- 모든 전이는 `UPDATE rallies SET status=... WHERE id=? AND status=?` 패턴(낙관적 상태 가드) — affected rows 0이면 이미 처리된 것으로 보고 skip.
- `orderId` 유니크 제약으로 결제 이중 청구 원천 차단.
- 알림톡(Solapi) 발송은 전이 트랜잭션 밖에서(발송 실패가 전이를 롤백시키지 않도록), 발송 로그 테이블은 기존 것 재사용.

---

## 7. tRPC 엔드포인트 스케치 (라우터 경계만)

```
rally.create            (개설: 행사·권역·방향 / goal·cap·정원은 서버 산정)
rally.get / rally.list  (게이지 = pledgeSum/goal, 확정 후엔 snapshot 기준 응답)
rally.pledge            (dongCode + billingKeyId → PLEDGED)  ← 후보 정류장 미노출 시 거부
rally.withdraw          (PLEDGED → WITHDRAWN, RECRUITING/NOTICE에서만)
rally.candidateStops    (dongCode → 후보 정류장 목록: 신청 화면 선노출용)
billing.registerCard    (토스 빌링키 발급 플로우)
admin.rally.cancel / admin.demand.refund / admin.demand.promote (수동 대기 승격)
```

---

## 8. 불변식 체크리스트 (구현·리뷰 시 검증)

1. PLEDGED 상태에서 `payment_attempts` 행이 존재하면 버그다 (확정 전 결제 없음).
2. `chargedAmountKrw ≤ pledgeAmountKrw` — 위반 시 결제 요청 자체를 reject.
3. `CONFIRMED` 이후 `rally_snapshots.stopsJson/routeJson/perPersonFareKrw` UPDATE 경로가 코드에 존재하지 않는다.
4. `CONFIRMED` 이후 화면·알림에 노출되는 정류장/시각/요금의 데이터 소스는 snapshot 단일 원천이다.
5. 다른 참여자의 상태 변화(WITHDRAWN/REVOKED)가 기존 CHARGED 참여자의 금액을 변경시키지 않는다.
6. 배정은 `roadviewVerifiedAt IS NOT NULL AND isActive` 인 정류장만 대상으로 한다.
7. 동일 (rallyId, userId) 약정 중복 불가. 동일 orderId 결제 중복 불가.
8. 모든 상태 전이 크론은 2회 연속 실행해도 결과가 같다(멱등).

---

## 9. 구현 순서 제안 (Claude Code 프롬프트 단위)

1. 스키마 마이그레이션: §4 테이블 추가 (`drizzle-kit push`) + enum/인덱스 검증
2. `rally.candidateStops` + 신청 화면(동 입력 → 후보 노출) — 기존 정류장 풀 데이터 시딩 포함
3. 빌링키 등록 플로우 (`billing.registerCard`, 토스 위젯 연동은 스펙 ③에서 상세)
4. `rally.pledge / withdraw` + 게이지 조회
5. 상태 전이 크론 3종 (`noticeTransition`, `confirmTransition`, `completeTransition`) — 결제는 mock으로 먼저
6. 최종 배정 + 저인원 병합 (기존 merge.ts 연결, `assignment_runs` 기록)
7. `rally_snapshots` 생성 + snapshot 기반 조회 전환
8. `chargeWorker / chargeRetry` 실 토스 연동
9. 관리자 수동 도구 (cancel / refund / promote)

— 끝 —
