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
  index,
} from "drizzle-orm/mysql-core";

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  phone: varchar("phone", { length: 20 }),
  referralCode: varchar("referralCode", { length: 16 }).unique(),
  pointsBalance: int("pointsBalance").default(0).notNull(),
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
    "awards",
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
  status: mysqlEnum("status", ["pending", "paid", "cancelled", "refunded"])
    .default("pending")
    .notNull(),
  totalAmount: int("totalAmount").notNull(),
  pointsUsed: int("pointsUsed").default(0).notNull(),
  passengerName: varchar("passengerName", { length: 100 }),
  passengerPhone: varchar("passengerPhone", { length: 20 }),
  passengerEmail: varchar("passengerEmail", { length: 320 }),
  paymentId: varchar("paymentId", { length: 200 }),
  paymentMethod: varchar("paymentMethod", { length: 50 }),
  qrToken: varchar("qrToken", { length: 64 }),
  referralCode: varchar("referralCode", { length: 16 }),
  cancelledAt: timestamp("cancelledAt"),
  cancelReason: text("cancelReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Reservation = typeof reservations.$inferSelect;
export type InsertReservation = typeof reservations.$inferInsert;

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
