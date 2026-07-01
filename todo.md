# 번개GO — 프로젝트 TODO

## Phase 1: DB 스키마 & 마이그레이션
- [x] events 테이블 (이벤트명, 날짜, 장소, 카테고리, 이미지, 상태)
- [x] trips 테이블 (event_id, 모드, 상태, 최소/최대 인원, 현재 인원, 운임, 출발시간)
- [x] boarding_points 테이블 (trip_id, 이름, 주소, lat, lng, 픽업시간)
- [x] reservations 테이블 (user_id, trip_id, boarding_point_id, 좌석수, 상태, 결제정보, QR토큰)
- [x] referrals 테이블 (referrer_id, referee_id, 포인트)
- [x] points 테이블 (user_id, 타입, 금액, 참조)
- [x] users 테이블 확장 (referral_code, points_balance, role)
- [x] tRPC 라우터 (events, trips, reservations, referrals, points, admin)

## Phase 2: 글로벌 디자인 & 레이아웃
- [x] 글로벌 CSS 변수 및 색상 팔레트 (퍼플 포인트 컬러 #5B4DFF)
- [x] 폰트 설정 (Pretendard / Inter)
- [x] 공통 Navbar 컴포넌트
- [x] 공통 Footer 컴포넌트
- [x] 라우팅 구조 (App.tsx)
- [x] 랜딩 홈 페이지

## Phase 3: 이벤트 목록 페이지
- [x] 이벤트 카드 컴포넌트 (이미지, 이름, 날짜, 장소, 카테고리 뱃지)
- [x] 모집 현황 프로그레스 바
- [x] '확정됨!' 뱃지 (최소 인원 달성 시)
- [x] 카테고리 필터 탭
- [x] 날짜 필터
- [x] 검색바
- [x] 무한 스크롤 / 페이지네이션

## Phase 4: 이벤트 상세 페이지
- [x] 이벤트 정보 헤더
- [x] 셔틀 목록 (모드 뱃지, 운임, 인원 프로그레스)
- [x] 탑승 포인트 목록
- [x] 지도 표시 (Google Maps)
- [x] 남은 좌석 수 실시간 업데이트

## Phase 5: 예약 플로우
- [x] Step 1: 탑승 포인트 선택
- [x] Step 2: 좌석 수 선택
- [x] Step 3: 예약자 정보 입력
- [x] Step 4: 결제 (모의 결제)
- [x] 예약 완료 페이지

## Phase 6: 이벤트 생성 Wizard
- [x] Step 1: 이벤트 정보 (이름/카테고리/날짜/장소)
- [x] Step 2: 셔틀 설정 (모드/출발시간/최소인원/운임)
- [x] Step 3: 탑승 포인트 추가
- [x] Step 4: 확인 및 등록

## Phase 7: 레퍼럴 & 마이페이지
- [x] 고유 초대 링크 생성
- [x] 레퍼럴 포인트 적립 로직
- [x] 마이페이지: 예약 내역
- [x] 마이페이지: 포인트 내역
- [x] 마이페이지: 레퍼럴 현황
- [x] 예약 취소 기능

## Phase 8: 관리자 대시보드
- [x] 이벤트 목록 및 관리
- [x] 예약 목록 조회
- [x] 사용자 목록 조회
- [x] 이벤트 확정/취소 처리
- [x] 셔틀 확정/취소 처리

## Phase 9: 빌드 검증
- [x] TypeScript 오류 없음 (0 errors)
- [x] Vitest 테스트 작성 (17개 테스트 통과)
- [x] 전체 페이지 스크린샷 검증
- [x] 체크포인트 저장

## 추후 개선 사항 (Phase 2)
- [ ] 실제 결제 연동 (Toss Payments / KakaoPay)
- [ ] 이메일/SMS 알림
- [ ] 실시간 좌석 현황 WebSocket (현재 30초 polling으로 대체)


## 리브랜딩: 번개GO (노란색 테마)
- [x] 브랜드명 번개GO → 번개GO 변경
- [x] 로고 업로드 및 Navbar 적용
- [x] 색상 팔레트 변경 (퍼플 → 노란색 #FFC107)
- [x] 모든 페이지 노란색 테마 적용
- [x] 스크린샷 검증
- [x] 리브랜딩 체크포인트 저장
