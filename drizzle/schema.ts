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
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  status: mysqlEnum("status", USER_STATUSES).default("active").notNull(),
  phone: varchar("phone", { length: 20 }),
  referralCode: varchar("referralCode", { length: 16 }).unique(),
  pointsBalance: int("pointsBalance").default(0).notNull(),
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
  category: mysqlEnum("category", [
    "concert",
    "sports",
    "festival",
    "rally",
    "exhibition",
    "other",
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
  status: mysqlEnum("status", ["active", "cancelled", "completed"])
    .default("active")
    .notNull(),
  creatorId: int("creatorId"),
  organizerName: varchar("organizerName", { length: 200 }),
  autoMatchEnabled: boolean("autoMatchEnabled").default(false).notNull(),
  autoMatchPricePerSeat: int("autoMatchPricePerSeat"),
  matchingFrozenAt: timestamp("matchingFrozenAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Event = typeof events.$inferSelect;
export type InsertEvent = typeof events.$inferInsert;

// ─── Trips (Shuttles) ─────────────────────────────────────────────────────────
export const TRIP_CANCEL_REASONS = ["admin_cancel", "min_count_not_met"] as const;
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
  seatNo: varchar("seatNo", { length: 10 }),
  pointsUsed: int("pointsUsed").default(0).notNull(),
  passengerName: varchar("passengerName", { length: 100 }),
  passengerPhone: varchar("passengerPhone", { length: 20 }),
  passengerEmail: varchar("passengerEmail", { length: 320 }),
  qrToken: varchar("qrToken", { length: 64 }),
  referralCode: varchar("referralCode", { length: 16 }),
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
