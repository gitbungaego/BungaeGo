# reservations 레거시 컬럼 — DROP 보류 기록

`drizzle/0002_flippant_firedrake.sql`이 `reservations`에서 `status`/`totalAmount`/`paymentId`/`paymentMethod`/`cancelledAt`/`cancelReason` 6개 컬럼을 제거하는 마이그레이션인데, **로컬에는 적용됐지만 프로덕션(`test`)에는 2026-07-13 현재 미적용 상태**다. (경위: [DEPLOYMENT.md](./DEPLOYMENT.md)의 스키마 drift 감사 참고.)

이 문서는 DROP을 실행하기 전에, 프로덕션에 남아있는 실데이터가 뭔지 남겨두는 기록이다. **이번 세션에서는 DROP을 실행하지 않는다** — 별도 세션에서 백업 후 진행 예정.

## 배경

`payments` 테이블 아키텍처 도입(2026-07-03, `ba905e7`) 이후 `reservations.status`/`totalAmount`/`paymentId`/`paymentMethod`/`cancelledAt`/`cancelReason`은 코드에서 더 이상 쓰지 않는다 (`server/`, `client/` 전체 grep 확인, 결제/취소 상태는 이제 `payments` 테이블이 단일 소스). 프로덕션에 아직 남아있는 이 6개 컬럼은 **갱신되지 않고 방치된 스냅샷**이다.

## 프로덕션 reservations 전체 (4행, 2026-07-13 기준)

```json
[
  {
    "id": 30001,
    "userId": 1,
    "tripId": 30014,
    "boardingPointId": 30025,
    "seats": 1,
    "status": "cancelled",
    "totalAmount": 19000,
    "pointsUsed": 0,
    "passengerName": "관리자",
    "passengerPhone": "01053732657",
    "passengerEmail": "local-admin-openid@local.dev",
    "paymentId": null,
    "paymentMethod": "mock_card",
    "qrToken": "ghP_lsoutnFBJcOt_1kNN6Byur6obn3L",
    "referralCode": null,
    "cancelledAt": "2026-07-03T17:25:41.000Z",
    "cancelReason": null,
    "createdAt": "2026-07-03T10:21:13.000Z",
    "updatedAt": "2026-07-03T17:25:40.000Z",
    "seatNo": null
  },
  {
    "id": 60001,
    "userId": 1,
    "tripId": 30001,
    "boardingPointId": null,
    "seats": 1,
    "status": "pending",
    "totalAmount": 0,
    "pointsUsed": 0,
    "passengerName": "smoketest-delete-me",
    "passengerPhone": "010-0000-0000",
    "passengerEmail": "smoketest@example.invalid",
    "paymentId": null,
    "paymentMethod": null,
    "qrToken": "zLLQNqUTloCdASIFMRbMAlTe7_V7M-Hl",
    "referralCode": null,
    "cancelledAt": null,
    "cancelReason": null,
    "createdAt": "2026-07-05T11:14:59.000Z",
    "updatedAt": "2026-07-05T11:14:59.000Z",
    "seatNo": null
  },
  {
    "id": 90001,
    "userId": 1470015,
    "tripId": 30014,
    "boardingPointId": 30025,
    "seats": 1,
    "status": "pending",
    "totalAmount": 0,
    "pointsUsed": 0,
    "passengerName": "카카오사용자",
    "passengerPhone": "0",
    "passengerEmail": null,
    "paymentId": null,
    "paymentMethod": null,
    "qrToken": "13APs2Nkqd7EZHXSRBhHzoJsJGOpik4l",
    "referralCode": null,
    "cancelledAt": null,
    "cancelReason": null,
    "createdAt": "2026-07-05T12:47:09.000Z",
    "updatedAt": "2026-07-05T12:47:09.000Z",
    "seatNo": null
  },
  {
    "id": 120001,
    "userId": 1470015,
    "tripId": 90001,
    "boardingPointId": null,
    "seats": 1,
    "status": "pending",
    "totalAmount": 0,
    "pointsUsed": 0,
    "passengerName": "카카오사용자",
    "passengerPhone": "ㄹ",
    "passengerEmail": null,
    "paymentId": null,
    "paymentMethod": null,
    "qrToken": "i1afuDOHzYevcbAWHeMbBnCyyzbtTBvw",
    "referralCode": null,
    "cancelledAt": null,
    "cancelReason": null,
    "createdAt": "2026-07-07T16:00:10.000Z",
    "updatedAt": "2026-07-07T16:00:10.000Z",
    "seatNo": null
  }
]
```

## id=30001 조인 (event/trip/user)

```json
{
  "id": 30001,
  "eventId": 30010,
  "eventTitle": "2026 VERNON THE 8 [V8] LIVE - GOYANG",
  "tripId": 30014,
  "tripStatus": "cancelled",
  "departureAt": "2026-07-10T20:30:00.000Z",
  "userId": 1,
  "userOpenId": "local-admin-openid",
  "userName": "관리자"
}
```

## 행별 해석

| id | 실체 | 근거 |
|---|---|---|
| **30001** | 개발자 본인(`local-admin-openid`, 로컬 admin 폴백 계정)의 수동 결제 테스트. `payments.id=1`이 같은 예약을 가리키며 상태도 `cancelled`로 일치. | `passengerEmail: local-admin-openid@local.dev`, `passengerName: 관리자` |
| **60001** | 명시적 스모크테스트 쓰레기 데이터. `passengerName`부터 "삭제해달라"는 표시. | `passengerName: "smoketest-delete-me"`, `passengerEmail: smoketest@example.invalid` |
| **90001** | 개발자 본인의 실 카카오 계정(`kakao:4977451412`, userId 1470015)으로 한 로그인/결제 흐름 테스트. `passengerPhone: "0"`은 명백한 더미 입력. | `passengerName: "카카오사용자"`(카카오 로그인 기본 표시명), `passengerPhone: "0"` |
| **120001** | 위와 동일 계정의 추가 테스트. `passengerPhone: "ㄹ"`은 키보드를 아무렇게나 눌러 넣은 값 — 실사용자 데이터가 아님. | `passengerPhone: "ㄹ"` |

**공통적으로 중요한 점**: 4행 중 3행(`60001`/`90001`/`120001`)은 `reservations.status`가 `"pending"`으로 남아있지만, 실제 진실 소스인 `payments` 테이블에서는 전부 `"cancelled"`(사유: `user_request` 또는 `trip_not_confirmed` 자동환불)다. 즉 이 레거시 컬럼들은 단순히 "안 쓰임"을 넘어서 **현재 상태와 불일치하는 오래된 값**이라, 남겨둬도 참고 가치가 없고 실수로 참조하면 오히려 틀린 상태를 보여준다.

결론: 4행 전부 **개발자 본인의 테스트/스모크 데이터**이며 제3자 실사용자 데이터 없음. `payments`/`payment_items` 테이블에 동등하거나 더 정확한 기록이 이미 남아있어 DROP해도 정보 유실이 없다 (단, `reservations.totalAmount=19000`처럼 레거시 컬럼에만 있던 스냅샷 값 자체는 DROP 시 사라짐 — 필요하면 이 문서가 그 백업 역할을 한다).

## 처리 방침

- **코드**: 이미 사용 중단 완료 (schema.ts에서 빠진 지 1주일+, grep으로 참조 없음 확인).
- **이번 세션에서 DROP 실행하지 않음.**
- 다음 세션에서: (1) 위 4행을 별도 백업(export) → (2) `drizzle/0002_flippant_firedrake.sql`을 프로덕션에 적용(`scripts/apply-0002-migration.cjs`) → (3) DESCRIBE로 컬럼 제거 확인 → (4) DEPLOYMENT.md 마이그레이션 표 갱신.
