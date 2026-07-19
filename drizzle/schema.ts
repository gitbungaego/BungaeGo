import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  boolean,
  json,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ─── Users ───────────────────────────────────────────────────────────────────
export const USER_STATUSES = ["active", "suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  // name = 표시용 닉네임 (마이페이지에서 자유 수정, 카카오 재로그인이 덮어쓰지 않음).
  name: text("name"),
  // realName = 카카오 로그인 시 수집한 실명 (name/phone_number 동의항목 승인 시).
  realName: varchar("realName", { length: 100 }),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  status: mysqlEnum("status", USER_STATUSES).default("active").notNull(),
  phone: varchar("phone", { length: 20 }),
  referralCode: varchar("referralCode", { length: 16 }).unique(),
  pointsBalance: int("pointsBalance").default(0).notNull(),
  // 포인트 만료일 — 전체 리셋 방식: 적립(EARN_*) 발생 시 NOW+TTL(기본 365일)로 갱신,
  // 보유 잔액 전체에 적용 (referral-credit-spec §6). NULL = 만료 관리 이전 잔액(만료 없음).
  pointsExpiresAt: timestamp("pointsExpiresAt"),
  gender: mysqlEnum("gender", ["M", "F"]),
  birthDate: date("birthDate"),
  verifiedAt: timestamp("verifiedAt"),
  verificationProvider: varchar("verificationProvider", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Events ──────────────────────────────────────────────────────────────────
export const events = mysqlTable("events", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  // 카테고리 확장(2026-07): 지역축제/엑스포/박람회/포럼 — 홈 카카오T식 칩 필터와 1:1.
  category: mysqlEnum("category", [
    "concert",
    "sports",
    "festival",
    "rally",
    "exhibition",
    "other",
    "local_festival",
    "expo",
    "fair",
    "forum",
  ])
    .default("other")
    .notNull(),
  eventDate: timestamp("eventDate").notNull(),
  venue: varchar("venue", { length: 200 }).notNull(),
  address: varchar("address", { length: 400 }),
  lat: decimal("lat", { precision: 10, scale: 7 }),
  lng: decimal("lng", { precision: 10, scale: 7 }),
  imageUrl: text("imageUrl"),
  description: text("description"),
  // "deleted" is the admin soft-delete state: hidden from public lists/search
  // (getEvents filters status="active") but kept in the DB and admin views.
  status: mysqlEnum("status", ["active", "cancelled", "completed", "deleted"])
    .default("active")
    .notNull(),
  creatorId: int("creatorId"),
  organizerName: varchar("organizerName", { length: 200 }),
  // Comma-separated hidden search keywords bridging Korean↔English spellings
  // (e.g. "CORTIS,코르티스,cortis"). Never displayed; only fed into the search
  // OR-match so "코르티스" finds "CORTIS".
  searchAliases: text("searchAliases"),
  // Comma-separated public tags (genre/venue/artist, e.g. "K-POP,고척돔").
  // Shown as small badges on the event detail hero and also searched.
  tags: text("tags"),
  autoMatchEnabled: boolean("autoMatchEnabled").default(false).notNull(),
  autoMatchPricePerSeat: int("autoMatchPricePerSeat"),
  matchingFrozenAt: timestamp("matchingFrozenAt"),
  // Who froze the matching: "admin" (manual freeze button) or "auto" (D-7
  // scheduler). Null while unfrozen. Purely informational for the admin UI —
  // the freeze itself is gated on matchingFrozenAt.
  matchingFrozenBy: mysqlEnum("matchingFrozenBy", ["admin", "auto"]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Event = typeof events.$inferSelect;
export type InsertEvent = typeof events.$inferInsert;

// ─── Event Likes (하트/찜) ──────────────────────────────────────────────────────
// One row per (event, user) like. No denormalized count on events — like
// counts are COUNT() aggregates, which is plenty at this scale. The unique
// index makes the toggle idempotent at the DB level: a duplicate like can
// never create a second row.
export const eventLikes = mysqlTable(
  "event_likes",
  {
    id: int("id").autoincrement().primaryKey(),
    eventId: int("eventId").notNull(),
    userId: int("userId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("event_likes_event_user_idx").on(table.eventId, table.userId)]
);

export type EventLike = typeof eventLikes.$inferSelect;
export type InsertEventLike = typeof eventLikes.$inferInsert;

// ─── Point Interests (+1 여기서 출발 원해요) ────────────────────────────────────
// One row per (event, rally point candidate, user): a no-payment demand signal
// for where the next trip should be routed. Same pattern as event_likes —
// counts are COUNT() aggregates, and the unique index makes the toggle
// idempotent at the DB level.
export const pointInterests = mysqlTable(
  "point_interests",
  {
    id: int("id").autoincrement().primaryKey(),
    eventId: int("eventId").notNull(),
    rallyPointCandidateId: int("rallyPointCandidateId").notNull(),
    userId: int("userId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("point_interests_event_candidate_user_idx").on(
      table.eventId,
      table.rallyPointCandidateId,
      table.userId
    ),
  ]
);

export type PointInterest = typeof pointInterests.$inferSelect;
export type InsertPointInterest = typeof pointInterests.$inferInsert;

// ─── Trips (Shuttles) ─────────────────────────────────────────────────────────
// gender_ratio_not_met: 번개팅 회차가 D-5에 성비(반반 minM/minF, 전용 최소인원)
// 미달로 자동취소된 경우. min_count_not_met과 구분하되 처리(전액환불)는 동일 (spec §2-2).
export const TRIP_CANCEL_REASONS = ["admin_cancel", "min_count_not_met", "gender_ratio_not_met"] as const;
export type TripCancelReason = (typeof TRIP_CANCEL_REASONS)[number];

export const trips = mysqlTable("trips", {
  id: int("id").autoincrement().primaryKey(),
  eventId: int("eventId").notNull(),
  mode: mysqlEnum("mode", ["bus", "van"]).default("bus").notNull(),
  status: mysqlEnum("status", [
    "collecting",
    "confirmed",
    "in_progress",
    "completed",
    "cancelled",
  ])
    .default("collecting")
    .notNull(),
  cancelReason: mysqlEnum("cancelReason", TRIP_CANCEL_REASONS),
  minCount: int("minCount").default(15).notNull(),
  maxCount: int("maxCount").default(45).notNull(),
  currentCount: int("currentCount").default(0).notNull(),
  price: int("price").notNull(),
  // 편도(행사장행/귀가행) 탑승권 1인 요금 — 관리자가 지정. NULL이면 왕복 셔틀이라도
  // 편도 탑승권을 팔지 않는다 (예약창에 왕복만 노출).
  oneWayPrice: int("oneWayPrice"),
  departureAt: timestamp("departureAt").notNull(),
  returnAt: timestamp("returnAt"),
  isRoundTrip: boolean("isRoundTrip").default(false).notNull(),
  operatorName: varchar("operatorName", { length: 200 }),
  operatorContact: varchar("operatorContact", { length: 50 }),
  notes: text("notes"),
  creatorId: int("creatorId"),
  sourceClusterId: int("sourceClusterId"),
  theme: varchar("theme", { length: 20 }).default("standard").notNull(),
  themeConfig: json("themeConfig"),
  // 번개팅 회차 카카오 오픈채팅방 링크 (spec §3-6, 축소판). 관리자가 확정 시 입력.
  // 인앱 채팅 대신 외부 오픈채팅으로 운영 — 확정 참가자에게만 노출. 표준 트립은 미사용.
  openChatUrl: varchar("openChatUrl", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Trip = typeof trips.$inferSelect;
export type InsertTrip = typeof trips.$inferInsert;

// ─── Boarding Points ──────────────────────────────────────────────────────────
export const boardingPoints = mysqlTable("boarding_points", {
  id: int("id").autoincrement().primaryKey(),
  tripId: int("tripId").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  address: varchar("address", { length: 400 }),
  lat: decimal("lat", { precision: 10, scale: 7 }),
  lng: decimal("lng", { precision: 10, scale: 7 }),
  pickupTime: timestamp("pickupTime"),
  order: int("order").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BoardingPoint = typeof boardingPoints.$inferSelect;
export type InsertBoardingPoint = typeof boardingPoints.$inferInsert;

// ─── Reservations ─────────────────────────────────────────────────────────────
export const reservations = mysqlTable("reservations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tripId: int("tripId").notNull(),
  boardingPointId: int("boardingPointId"),
  seats: int("seats").default(1).notNull(),
  // 탑승권 종류: round=전 구간(왕복 셔틀이면 왕복), outbound=행사장행, inbound=귀가행.
  // 편도는 왕복 셔틀(isRoundTrip)에서 oneWayPrice가 설정된 경우에만 판매.
  ticketType: mysqlEnum("ticketType", ["round", "outbound", "inbound"]).default("round").notNull(),
  seatNo: varchar("seatNo", { length: 10 }),
  pointsUsed: int("pointsUsed").default(0).notNull(),
  passengerName: varchar("passengerName", { length: 100 }),
  passengerPhone: varchar("passengerPhone", { length: 20 }),
  passengerEmail: varchar("passengerEmail", { length: 320 }),
  qrToken: varchar("qrToken", { length: 64 }),
  referralCode: varchar("referralCode", { length: 16 }),
  // 사용자가 취소된 내역을 마이페이지에서 지운 시각 — 소프트 숨김(실삭제 아님).
  // 관리자 목록/감사에는 그대로 남는다.
  hiddenAt: timestamp("hiddenAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Reservation = typeof reservations.$inferSelect;
export type InsertReservation = typeof reservations.$inferInsert;

// ─── Payments ─────────────────────────────────────────────────────────────────
export const PAYMENT_METHODS = [
  "card",
  "kakaopay",
  "naverpay",
  "tosspay",
  "transfer",
  "vbank",
  "mock",
  "toss",
] as const;
export const CHARGE_TYPES = ["billing", "prepaid"] as const;
export const PAYMENT_CANCEL_REASONS = [
  "user_request",
  "trip_not_confirmed",
  "admin",
  "payment_failed",
] as const;
export const PAYMENT_ITEM_TYPES = ["fare", "theme_fee", "discount"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type ChargeType = (typeof CHARGE_TYPES)[number];
export type PaymentCancelReason = (typeof PAYMENT_CANCEL_REASONS)[number];
export type PaymentItemType = (typeof PAYMENT_ITEM_TYPES)[number];

export const payments = mysqlTable(
  "payments",
  {
    id: int("id").autoincrement().primaryKey(),
    // Nullable: a Toss payment is created as a pending "order" before the
    // reservation exists, and linked to the reservation only after approval.
    reservationId: int("reservationId"),
    totalAmount: int("totalAmount").notNull(),
    status: mysqlEnum("status", ["pending", "paid", "cancelled", "refunded"])
      .default("pending")
      .notNull(),
    method: mysqlEnum("method", PAYMENT_METHODS).notNull(),
    chargeType: mysqlEnum("chargeType", CHARGE_TYPES).default("prepaid").notNull(),
    // Track B (auto-match): the ride request this payment funds. Set at
    // confirm time; survives matching recomputes (reservations get rebuilt,
    // the payment doesn't) and is how commit finds the payment to link the
    // final reservation and refund the cap-vs-final difference against.
    rideRequestId: int("rideRequestId"),
    // Cumulative amount already refunded via Toss partial cancels (difference
    // refunds). Lets a matching recompute top up to a new target instead of
    // double-refunding.
    refundedAmount: int("refundedAmount").default(0).notNull(),
    // Merchant-generated order number handed to Toss; unique so the confirm
    // callback can resolve exactly one pending order.
    orderId: varchar("orderId", { length: 64 }),
    // Toss-issued payment key, set once the payment is approved. Required for
    // any later cancel/refund API call.
    tossPaymentKey: varchar("tossPaymentKey", { length: 200 }),
    // What this order should create once approved (reservation / ride request
    // input captured server-side at order creation, never re-trusted from the
    // client at confirm time).
    orderContext: json("orderContext"),
    paidAt: timestamp("paidAt"),
    cancelledAt: timestamp("cancelledAt"),
    cancelReason: mysqlEnum("cancelReason", PAYMENT_CANCEL_REASONS),
    cancelNote: varchar("cancelNote", { length: 300 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("payments_reservation_idx").on(table.reservationId),
    index("payments_ride_request_idx").on(table.rideRequestId),
    uniqueIndex("payments_order_id_idx").on(table.orderId),
  ]
);

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

// ─── Payment Items ────────────────────────────────────────────────────────────
export const paymentItems = mysqlTable(
  "payment_items",
  {
    id: int("id").autoincrement().primaryKey(),
    paymentId: int("paymentId").notNull(),
    type: mysqlEnum("type", PAYMENT_ITEM_TYPES).notNull(),
    amount: int("amount").notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("payment_items_payment_idx").on(table.paymentId)]
);

export type PaymentItem = typeof paymentItems.$inferSelect;
export type InsertPaymentItem = typeof paymentItems.$inferInsert;

// ─── Referrals ────────────────────────────────────────────────────────────────
export const referrals = mysqlTable("referrals", {
  id: int("id").autoincrement().primaryKey(),
  referrerId: int("referrerId").notNull(),
  refereeId: int("refereeId").notNull(),
  reservationId: int("reservationId"),
  referrerPoints: int("referrerPoints").default(2000).notNull(),
  refereePoints: int("refereePoints").default(1000).notNull(),
  status: mysqlEnum("status", ["pending", "completed", "cancelled"])
    .default("pending")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Referral = typeof referrals.$inferSelect;
export type InsertReferral = typeof referrals.$inferInsert;

// ─── Points ───────────────────────────────────────────────────────────────────
export const points = mysqlTable("points", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", [
    "referral_earn",
    "booking_earn",
    "admin_grant",
    "usage",
    "refund",
    "welcome",
  ]).notNull(),
  amount: int("amount").notNull(),
  balanceAfter: int("balanceAfter").default(0).notNull(),
  description: varchar("description", { length: 300 }),
  refId: varchar("refId", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Point = typeof points.$inferSelect;
export type InsertPoint = typeof points.$inferInsert;

// ─── Point Transactions (신규 통합 원장 — referral-credit-spec §8) ─────────────
// append-only. 기존 `points` 테이블은 레거시 읽기 전용으로 유지하고, 모든 신규
// 적립/차감은 이 원장을 경유한다 (addPoints가 위임). 잔액 진실 원천은 원장 합계,
// users.pointsBalance는 캐시(트랜잭션 내 SELECT ... FOR UPDATE로 동시 갱신).
export const POINT_TX_TYPES = [
  "EARN_REFERRAL",
  "EARN_PROMO",
  "SPEND",
  "REFUND",
  "EXPIRE",
  "ADMIN_ADJUST",
] as const;
export type PointTxType = (typeof POINT_TX_TYPES)[number];

export const pointTransactions = mysqlTable(
  "point_transactions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    type: mysqlEnum("type", POINT_TX_TYPES).notNull(),
    amount: int("amount").notNull(), // EARN/REFUND 양수, SPEND/EXPIRE 음수
    balanceAfter: int("balanceAfter").notNull(),
    relatedTripId: int("relatedTripId"),
    relatedReferralEntryId: int("relatedReferralEntryId"),
    memo: varchar("memo", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_pt_user_created").on(t.userId, t.createdAt)]
);

export type PointTransaction = typeof pointTransactions.$inferSelect;

// ─── Referral Entries (주문 단위 추천 건 — referral-credit-spec §3~4) ──────────
// 결제(예약) 1건당 코드 1개. 셔틀(trip)이 completed 도달 시 PENDING 건을 정산해
// 추천인에게 실결제액 × 요율(참가자 5% / 기본 2%, 상한 5,000원) 적립.
// appliedRate는 생성 시점 스냅샷 — 이후 재판정하지 않는다 (§4.2).
export const REFERRAL_ENTRY_STATUSES = ["PENDING", "COMPLETED", "FLAGGED", "REJECTED", "VOID"] as const;
export type ReferralEntryStatus = (typeof REFERRAL_ENTRY_STATUSES)[number];

export const referralEntries = mysqlTable(
  "referral_entries",
  {
    id: int("id").autoincrement().primaryKey(),
    tripId: int("tripId").notNull(),
    reservationId: int("reservationId").notNull().unique(), // 결제 1건당 코드 1개
    payerUserId: int("payerUserId").notNull(),
    referrerUserId: int("referrerUserId").notNull(),
    code: varchar("code", { length: 16 }).notNull(),
    source: mysqlEnum("source", ["LINK_PREFILL", "MANUAL"]).default("MANUAL").notNull(),
    appliedRate: decimal("appliedRate", { precision: 4, scale: 3 }).notNull(), // 0.050 / 0.020 스냅샷
    referrerIsParticipant: boolean("referrerIsParticipant").notNull(), // 판정 근거 기록
    paidAmount: int("paidAmount").notNull(), // 실결제액(포인트 차감 후 실제 수금액) 스냅샷
    status: mysqlEnum("status", REFERRAL_ENTRY_STATUSES).default("PENDING").notNull(),
    flagReason: varchar("flagReason", { length: 200 }), // FLAGGED 사유 (관리자 검토용)
    rewardAmount: int("rewardAmount"), // 지급 시 확정 금액
    rewardTransactionId: int("rewardTransactionId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  (t) => [index("idx_re_trip").on(t.tripId), index("idx_re_referrer").on(t.referrerUserId)]
);

export type ReferralEntry = typeof referralEntries.$inferSelect;
export type InsertReferralEntry = typeof referralEntries.$inferInsert;

// ─── Reward Config (정책 설정 — 하드코딩 금지, referral-credit-spec §8) ─────────
// 행이 없으면 코드 기본값 사용. 관리자가 행을 넣어 요율/상한/TTL을 조정한다.
export const rewardConfig = mysqlTable("reward_config", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: varchar("value", { length: 255 }).notNull(),
});

// ─── Stop Candidates (reusable pickup locations) ───────────────────────────────
export const stopCandidates = mysqlTable("stop_candidates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  address: varchar("address", { length: 400 }),
  lat: decimal("lat", { precision: 10, scale: 7 }).notNull(),
  lng: decimal("lng", { precision: 10, scale: 7 }).notNull(),
  capacity: int("capacity"),
  safeForCoach: boolean("safeForCoach").default(true).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type StopCandidate = typeof stopCandidates.$inferSelect;
export type InsertStopCandidate = typeof stopCandidates.$inferInsert;

// ─── Rally Point Candidates (community-sourced, unverified pickup spots) ───────
// Distinct from stopCandidates: these are crowd-sourced suggestions with a
// separate confirmation state (busAccessible) rather than admin-vetted stops.
export const rallyPointCandidates = mysqlTable(
  "rally_point_candidates",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 200 }).notNull(),
    region: varchar("region", { length: 100 }).notNull(),
    lat: decimal("lat", { precision: 10, scale: 7 }).notNull(),
    lng: decimal("lng", { precision: 10, scale: 7 }).notNull(),
    busAccessible: boolean("busAccessible").default(false).notNull(),
    notes: varchar("notes", { length: 300 }),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("rally_point_candidates_name_region_idx").on(table.name, table.region)]
);

export type RallyPointCandidate = typeof rallyPointCandidates.$inferSelect;
export type InsertRallyPointCandidate = typeof rallyPointCandidates.$inferInsert;

// ─── Clusters (DBSCAN output, pre-route) ────────────────────────────────────────
export const clusters = mysqlTable("clusters", {
  id: int("id").autoincrement().primaryKey(),
  eventId: int("eventId").notNull(),
  groupKey: varchar("groupKey", { length: 100 }).notNull(),
  status: mysqlEnum("status", ["forming", "viable", "merged", "failed"])
    .default("forming")
    .notNull(),
  assignedStopId: int("assignedStopId"),
  assignedLat: decimal("assignedLat", { precision: 10, scale: 7 }),
  assignedLng: decimal("assignedLng", { precision: 10, scale: 7 }),
  isAdHocStop: boolean("isAdHocStop").default(false).notNull(),
  size: int("size").default(0).notNull(),
  tripId: int("tripId"),
  mergedIntoClusterId: int("mergedIntoClusterId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Cluster = typeof clusters.$inferSelect;
export type InsertCluster = typeof clusters.$inferInsert;

// ─── Ride Requests (pre-matching rider signup+payment) ──────────────────────────
export const rideRequests = mysqlTable(
  "ride_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    eventId: int("eventId").notNull(),
    userId: int("userId").notNull(),
    originAddress: varchar("originAddress", { length: 400 }),
    originLat: decimal("originLat", { precision: 10, scale: 7 }).notNull(),
    originLng: decimal("originLng", { precision: 10, scale: 7 }).notNull(),
    targetArrivalAt: timestamp("targetArrivalAt").notNull(),
    groupKey: varchar("groupKey", { length: 100 }),
    clusterId: int("clusterId"),
    tripId: int("tripId"),
    boardingPointId: int("boardingPointId"),
    reservationId: int("reservationId"),
    status: mysqlEnum("status", [
      "pending",
      "clustered",
      "route_confirmed",
      "boarded",
      "failed_refunded",
    ])
      .default("pending")
      .notNull(),
    seats: int("seats").default(1).notNull(),
    passengerName: varchar("passengerName", { length: 100 }),
    passengerPhone: varchar("passengerPhone", { length: 20 }),
    passengerEmail: varchar("passengerEmail", { length: 320 }),
    referralCodeUsed: varchar("referralCodeUsed", { length: 16 }),
    pointsUsed: int("pointsUsed").default(0).notNull(),
    totalAmount: int("totalAmount").notNull(),
    paymentId: varchar("paymentId", { length: 200 }),
    paymentMethod: varchar("paymentMethod", { length: 50 }),
    refundedAt: timestamp("refundedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("ride_requests_event_group_idx").on(table.eventId, table.groupKey),
    index("ride_requests_status_idx").on(table.status),
  ]
);

export type RideRequest = typeof rideRequests.$inferSelect;
export type InsertRideRequest = typeof rideRequests.$inferInsert;

// ─── Consents ─────────────────────────────────────────────────────────────────
export const consents = mysqlTable(
  "consents",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    type: varchar("type", { length: 50 }).notNull(),
    version: varchar("version", { length: 20 }).notNull(),
    agreedAt: timestamp("agreedAt").defaultNow().notNull(),
  },
  (table) => [index("consents_user_type_idx").on(table.userId, table.type)]
);

export type Consent = typeof consents.$inferSelect;
export type InsertConsent = typeof consents.$inferInsert;

// ─── Event Requests (이벤트 만들기 신청) ────────────────────────────────────────
// 번개고에 아직 등록되지 않은 행사의 셔틀을 원할 때 사용자가 제출하는 요청서.
// 운영자가 관리자 콘솔에서 검토 후 실제 이벤트/셔틀로 개설한다.
export const ARRIVAL_PREFERENCES = [
  "md_sale", // MD 판매시간에 도착하고 싶어요
  "ktx", // KTX 타야 해서 정시에 출발하고 싶어요
  "ticket_booth", // 티켓부스 오픈시간에 맞춰 도착하고 싶어요
  "flexible", // 공연 지연에 따라 출발시간이 변경됐으면 좋겠어요
  "etc", // 기타 (자유 입력)
] as const;
export type ArrivalPreference = (typeof ARRIVAL_PREFERENCES)[number];

export const eventRequests = mysqlTable("event_requests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  category: varchar("category", { length: 30 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  startDate: date("startDate", { mode: "string" }).notNull(),
  // 시작/종료 시각(HH:MM, 선택) — 날짜와 분리된 별도 입력(date 컬럼 타입 변경 없이 추가).
  startTime: varchar("startTime", { length: 5 }),
  endDate: date("endDate", { mode: "string" }),
  endTime: varchar("endTime", { length: 5 }),
  destination: varchar("destination", { length: 300 }).notNull(),
  origin: varchar("origin", { length: 300 }).notNull(),
  // 희망 도착 시각(HH:MM, 선택) — 이유(arrivalPreference)와 분리된 별도 입력.
  arrivalTime: varchar("arrivalTime", { length: 10 }),
  arrivalPreference: mysqlEnum("arrivalPreference", ARRIVAL_PREFERENCES).notNull(),
  arrivalNote: varchar("arrivalNote", { length: 300 }),
  inquiry: varchar("inquiry", { length: 500 }),
  phone: varchar("phone", { length: 20 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  status: mysqlEnum("status", ["pending", "done"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type EventRequest = typeof eventRequests.$inferSelect;
export type InsertEventRequest = typeof eventRequests.$inferInsert;

// ─── Shuttle Demands (셔틀 만들기 — 희망 탑승지 수요 신청) ──────────────────────
// 등록된 이벤트 중 원하는 노선이 없을 때, 카카오T 수요조사식으로 희망 탑승지를
// 신청한다. 유저당 이벤트당 1건(UNIQUE) — 재신청 시 upsert로 교체.
export const shuttleDemands = mysqlTable(
  "shuttle_demands",
  {
    id: int("id").autoincrement().primaryKey(),
    eventId: int("eventId").notNull(),
    userId: int("userId").notNull(),
    // capital = 서울/수도권 역 선택, other = 그 외 지역 선택
    area: mysqlEnum("area", ["capital", "other"]).notNull(),
    // 선택한 역/지역명 또는 직접 입력한 거점
    stopLabel: varchar("stopLabel", { length: 100 }).notNull(),
    // 그 외 지역에서 출발 동네(OO동) — 선택 입력
    neighborhood: varchar("neighborhood", { length: 100 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("shuttle_demands_event_user_idx").on(table.eventId, table.userId)]
);
export type ShuttleDemand = typeof shuttleDemands.$inferSelect;
export type InsertShuttleDemand = typeof shuttleDemands.$inferInsert;

// ─── Bungaeting (동행·친목 서브서비스) ──────────────────────────────────────────
// 소개팅·매칭이 아니라 "함께 탄 사람끼리 어울리는" 동행 서비스 (spec §1, §4 참고).
// 프로필(사진·나이·성별)은 번개고 대절 데이터와 분리 저장 — 조인 키(userId)만 유지 (spec §5).

export const GENDERS = ["M", "F"] as const;
export type Gender = (typeof GENDERS)[number];

// 성비 모드 4종 (spec §2): 일반(무조정)/반반(남녀 동수)/여성 전용/남성 전용.
// trips.themeConfig(번개팅 회차)와 선호 등록 양쪽에서 쓰는 단일 소스.
export const GENDER_MODES = ["any", "half", "female_only", "male_only"] as const;
export type GenderMode = (typeof GENDER_MODES)[number];

export const BUNGAETING_PROFILE_STATUSES = ["active", "blinded", "restricted"] as const;
export type BungaetingProfileStatus = (typeof BUNGAETING_PROFILE_STATUSES)[number];

export const bungaetingProfiles = mysqlTable(
  "bungaeting_profiles",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    nickname: varchar("nickname", { length: 30 }).notNull(),
    // TODO(R2): 현재는 URL 입력/미사용. 실제 업로드는 스토리지(R2) 연동 후 (spec §5, §7).
    photoUrl: text("photoUrl"),
    bio: varchar("bio", { length: 200 }),
    // 성별·생년월일은 본인인증 결과로 채운다 (사용자 자유 입력이 아님).
    gender: mysqlEnum("gender", GENDERS).notNull(),
    // mode:"string" — 'YYYY-MM-DD'로 그대로 저장/조회해 만 나이 계산 시 TZ 왜곡 방지.
    birthDate: date("birthDate", { mode: "string" }).notNull(),
    // 본인인증: 계약 전에는 mock 어댑터(provider='mock'). TODO: 포트원 연동 (spec §7).
    verifiedAt: timestamp("verifiedAt"),
    verificationProvider: varchar("verificationProvider", { length: 50 }),
    // 번개팅 별도 이용약관 동의 시각 (spec §3-2, 필수).
    tosAgreedAt: timestamp("tosAgreedAt"),
    status: mysqlEnum("status", BUNGAETING_PROFILE_STATUSES).default("active").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [uniqueIndex("bungaeting_profiles_user_idx").on(table.userId)]
);

export type BungaetingProfile = typeof bungaetingProfiles.$inferSelect;
export type InsertBungaetingProfile = typeof bungaetingProfiles.$inferInsert;

// 선호 등록: 조건에 맞는 회차가 열리면 SMS 알림 (spec §2, §6). 알림은 mock(console.log).
export const bungaetingPreferences = mysqlTable(
  "bungaeting_preferences",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    preferredGenderMode: mysqlEnum("preferredGenderMode", GENDER_MODES),
    preferredAgeMin: int("preferredAgeMin"),
    preferredAgeMax: int("preferredAgeMax"),
    preferredRegion: varchar("preferredRegion", { length: 100 }),
    // 관심 지역(선택) — preferredRegion은 UI에서 '거주지역'으로 재라벨링됨.
    interestRegion: varchar("interestRegion", { length: 100 }),
    // 선호 카테고리 — 이벤트 신청 카테고리 키의 쉼표 목록 (예: "concert,festival").
    preferredCategories: varchar("preferredCategories", { length: 300 }),
    preferredTheme: varchar("preferredTheme", { length: 100 }),
    smsOptIn: boolean("smsOptIn").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [uniqueIndex("bungaeting_preferences_user_idx").on(table.userId)]
);

export type BungaetingPreference = typeof bungaetingPreferences.$inferSelect;
export type InsertBungaetingPreference = typeof bungaetingPreferences.$inferInsert;

// ─── Bungaeting 회차 제안 + 찜 (spec §3-5) ─────────────────────────────────────
// 이용자가 행사+날짜를 제안 → 다른 이용자가 성비 모드별로 '찜' → 관리자가 정식 회차로
// 전환. 제안자에게는 비금전 보상(포인트). "이 회차에 관심"이지 "이 사람과 함께"가 아님(§4).
export const BUNGAETING_PROPOSAL_STATUSES = ["open", "converted", "closed"] as const;
export type BungaetingProposalStatus = (typeof BUNGAETING_PROPOSAL_STATUSES)[number];

export const bungaetingTripProposals = mysqlTable(
  "bungaeting_trip_proposals",
  {
    id: int("id").autoincrement().primaryKey(),
    eventId: int("eventId").notNull(),
    proposerId: int("proposerId").notNull(),
    proposedDate: timestamp("proposedDate").notNull(),
    notes: varchar("notes", { length: 300 }),
    status: mysqlEnum("status", BUNGAETING_PROPOSAL_STATUSES).default("open").notNull(),
    // 정식 회차 전환 시 연결되는 트립.
    convertedTripId: int("convertedTripId"),
    // 제안자 보상(포인트) 중복 지급 방지 플래그 — 조건부 UPDATE로 딱 한 번만 지급.
    rewardGrantedAt: timestamp("rewardGrantedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [index("bungaeting_trip_proposals_event_idx").on(table.eventId)]
);
export type BungaetingTripProposal = typeof bungaetingTripProposals.$inferSelect;
export type InsertBungaetingTripProposal = typeof bungaetingTripProposals.$inferInsert;

// 찜: (proposal, user) 유니크로 멱등 토글 (event_likes/point_interests와 동일 패턴).
// genderModePreference로 성비 모드별 관심을 구분 집계.
export const bungaetingProposalInterests = mysqlTable(
  "bungaeting_proposal_interests",
  {
    id: int("id").autoincrement().primaryKey(),
    proposalId: int("proposalId").notNull(),
    userId: int("userId").notNull(),
    genderModePreference: mysqlEnum("genderModePreference", GENDER_MODES),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("bungaeting_proposal_interests_proposal_user_idx").on(table.proposalId, table.userId)]
);
export type BungaetingProposalInterest = typeof bungaetingProposalInterests.$inferSelect;
export type InsertBungaetingProposalInterest = typeof bungaetingProposalInterests.$inferInsert;

// ─── Bungaeting 프로필 신고 (spec §3-7) ────────────────────────────────────────
// 채팅 신고는 카카오 오픈채팅 체계로 이전(⑤ 축소). 여기선 "프로필 신고"만 최소 처리.
// 참가자가 같은 회차의 다른 참가자 프로필을 신고 → 관리자가 검토해 블라인드/이용제한.
export const BUNGAETING_REPORT_STATUSES = ["pending", "reviewed_blinded", "reviewed_restricted", "dismissed"] as const;
export type BungaetingReportStatus = (typeof BUNGAETING_REPORT_STATUSES)[number];

export const bungaetingReports = mysqlTable(
  "bungaeting_reports",
  {
    id: int("id").autoincrement().primaryKey(),
    reporterId: int("reporterId").notNull(),
    targetUserId: int("targetUserId").notNull(),
    tripId: int("tripId").notNull(),
    reason: varchar("reason", { length: 300 }),
    status: mysqlEnum("status", BUNGAETING_REPORT_STATUSES).default("pending").notNull(),
    handledBy: int("handledBy"),
    handledAt: timestamp("handledAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  // 같은 신고자가 같은 회차의 같은 대상을 중복 신고 못 하게.
  (table) => [uniqueIndex("bungaeting_reports_reporter_target_trip_idx").on(table.reporterId, table.targetUserId, table.tripId)]
);
export type BungaetingReport = typeof bungaetingReports.$inferSelect;
export type InsertBungaetingReport = typeof bungaetingReports.$inferInsert;
