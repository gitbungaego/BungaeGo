// 레퍼럴·크레딧 시스템 (referral-credit-spec.md).
// 스펙의 "랠리"는 현재 코드베이스의 셔틀(trip)에 매핑한다:
//   COMPLETED = trips.status 'completed', FAILED/CANCELED = 'cancelled'.
// 결제 단위 = 예약(reservation) 1건, 실결제액 = 실제 수금액(요금 - 포인트 차감).
// 적립은 통합 포인트 원장(point_transactions)에 EARN_REFERRAL로 기록되며,
// 카드지문 동일성 검사는 빌링키 부재로 제외(전화번호 동일성만, spec §7-2 부분 적용).
import type { Trip, User } from "../drizzle/schema";
import {
  countRecentReferralEntriesByCode,
  createReferralEntry,
  getFlaggedReferralEntries,
  getReferralEntriesByTripId,
  getRewardConfigValues,
  getTripById,
  getUserById,
  getUserByReferralCode,
  getUsersWithExpiredPoints,
  getUsersWithPointsExpiringBefore,
  hasPaidReservationForEvent,
  recordPointTransaction,
  resolveFlaggedReferralEntry,
  settleReferralEntry,
  voidReferralEntriesByTripId,
  voidReferralEntryByReservationId,
} from "./db";
import { sendSms } from "./bungaeting/sms";

export type ReferralCodeValidation =
  | { ok: true; referrerUserId: number }
  | { ok: false; reason: string };

// 결제 요청 시 검증 (spec §3.3): 존재·셀프 금지·활성 상태.
export async function validateReferralCode(code: string, payerUserId: number): Promise<ReferralCodeValidation> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { ok: false, reason: "코드를 입력해주세요." };
  const referrer = await getUserByReferralCode(normalized);
  if (!referrer) return { ok: false, reason: "존재하지 않는 추천 코드입니다." };
  if (referrer.id === payerUserId) return { ok: false, reason: "본인 코드는 입력할 수 없습니다." };
  if (referrer.status !== "active") return { ok: false, reason: "사용할 수 없는 추천 코드입니다." };
  return { ok: true, referrerUserId: referrer.id };
}

/**
 * 예약(결제) 1건에 대한 추천 건 생성 (spec §3~4, §7).
 * - 요율은 생성 시점 스냅샷: 추천인이 동일 event에 결제 완료 예약 보유 → 참가자
 *   요율, 아니면 기본 요율. 이후 재판정하지 않는다 (§4.2).
 * - 어뷰징 검사: 전화번호 동일 / 동일 코드 일일 한도 초과 → FLAGGED (지급 보류).
 * - 실패해도 예약 자체를 깨뜨리지 않도록 호출부에서 try/catch로 감싼다.
 */
export async function createEntryForReservation(opts: {
  trip: Trip;
  reservationId: number;
  payer: User;
  code: string;
  source: "LINK_PREFILL" | "MANUAL";
  paidAmount: number;
}): Promise<number | null> {
  const code = opts.code.trim().toUpperCase();
  const referrer = await getUserByReferralCode(code);
  if (!referrer || referrer.id === opts.payer.id || referrer.status !== "active") return null;

  const config = await getRewardConfigValues();
  const isParticipant = await hasPaidReservationForEvent(referrer.id, opts.trip.eventId);
  const rate = isParticipant ? config.rateParticipant : config.rateDefault;

  // 어뷰징 검사 (spec §7-2, §7-4) — FLAGGED는 지급 보류 후 관리자 검토.
  let flagReason: string | null = null;
  if (opts.payer.phone && referrer.phone && opts.payer.phone === referrer.phone) {
    flagReason = "결제자와 추천인의 전화번호 동일";
  } else {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await countRecentReferralEntriesByCode(code, dayAgo);
    if (recentCount >= config.dailyCodeEntryLimit) {
      flagReason = `동일 코드 일일 입력 한도(${config.dailyCodeEntryLimit}건) 초과`;
    }
  }

  return createReferralEntry({
    tripId: opts.trip.id,
    reservationId: opts.reservationId,
    payerUserId: opts.payer.id,
    referrerUserId: referrer.id,
    code,
    source: opts.source,
    appliedRate: rate.toFixed(3),
    referrerIsParticipant: isParticipant,
    paidAmount: Math.max(0, opts.paidAmount),
    status: flagReason ? "FLAGGED" : "PENDING",
    flagReason,
  });
}

// 트립 completed 전이 시 일괄 정산 (spec §4.3). settleReferralEntry가 건별
// 트랜잭션 + PENDING 조건부 전환이라 중복 호출에도 exactly-once.
export async function settleTripReferrals(tripId: number): Promise<void> {
  const entries = await getReferralEntriesByTripId(tripId, "PENDING");
  for (const entry of entries) {
    try {
      const result = await settleReferralEntry(entry.id);
      if (result.granted && result.amount && result.amount > 0 && result.referrerUserId) {
        const referrer = await getUserById(result.referrerUserId);
        if (referrer?.phone) {
          await sendSms(
            referrer.phone,
            `[번개GO] 추천 적립 ${result.amount.toLocaleString()}P가 지급되었어요! (셔틀 운행 완료)`
          ).catch(() => undefined);
        }
      }
    } catch (error) {
      console.error(`[referralCredit] settle failed for entry ${entry.id}:`, error);
    }
  }
}

// 트립 무산/취소 시 해당 트립의 미지급 건 전부 VOID (spec §4.4).
export async function voidTripReferrals(tripId: number): Promise<void> {
  try {
    await voidReferralEntriesByTripId(tripId);
  } catch (error) {
    console.error(`[referralCredit] void by trip ${tripId} failed:`, error);
  }
}

// 결제자 자진 취소 시 해당 건만 VOID (spec §4.4 — 주문 단위라 다른 건 영향 없음).
export async function voidReservationReferral(reservationId: number): Promise<void> {
  try {
    await voidReferralEntryByReservationId(reservationId);
  } catch (error) {
    console.error(`[referralCredit] void by reservation ${reservationId} failed:`, error);
  }
}

// FLAGGED 관리자 결정: approve → PENDING 복귀(트립이 이미 completed면 즉시 정산),
// reject → REJECTED.
export async function resolveFlagged(entryId: number, action: "approve" | "reject"): Promise<boolean> {
  const entries = await getFlaggedReferralEntries();
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return false;
  const resolved = await resolveFlaggedReferralEntry(entryId, action);
  if (!resolved) return false;
  if (action === "approve") {
    const trip = await getTripById(entry.tripId);
    if (trip?.status === "completed") {
      await settleReferralEntry(entryId).catch((error) =>
        console.error(`[referralCredit] settle after approve failed for ${entryId}:`, error)
      );
    }
  }
  return true;
}

// ─── 포인트 만료 배치 (spec §6) ────────────────────────────────────────────────
const NOTICE_DAYS = [30, 7];
const DAY_MS = 24 * 60 * 60 * 1000;

function kstDayNumber(d: Date): number {
  return Math.floor((d.getTime() + 9 * 60 * 60 * 1000) / DAY_MS);
}

export async function runPointsExpiryBatch(now: Date = new Date()): Promise<{ expired: number; notified: number }> {
  let expired = 0;
  let notified = 0;

  // 1) 만료 처리: expires < now 인 잔액 전체를 EXPIRE로 0 처리.
  const expiredUsers = await getUsersWithExpiredPoints(now);
  for (const u of expiredUsers) {
    try {
      await recordPointTransaction({
        userId: u.id,
        type: "EXPIRE",
        amount: -u.pointsBalance,
        memo: "포인트 유효기간 만료 소멸",
      });
      expired++;
    } catch (error) {
      console.error(`[referralCredit] expire failed for user ${u.id}:`, error);
    }
  }

  // 2) 만료 예정 알림 (D-30, D-7 — KST 달력일 기준, mock SMS).
  const horizon = new Date(now.getTime() + 31 * DAY_MS);
  const upcoming = await getUsersWithPointsExpiringBefore(horizon);
  const today = kstDayNumber(now);
  for (const u of upcoming) {
    if (!u.phone || !u.pointsExpiresAt) continue;
    const daysLeft = kstDayNumber(u.pointsExpiresAt) - today;
    if (!NOTICE_DAYS.includes(daysLeft)) continue;
    const d = u.pointsExpiresAt;
    await sendSms(
      u.phone,
      `[번개GO] 포인트 ${u.pointsBalance.toLocaleString()}P가 ${d.getMonth() + 1}월 ${d.getDate()}일 소멸 예정입니다.`
    ).catch(() => undefined);
    notified++;
  }

  return { expired, notified };
}

// 일 1회 배치 — 인프로세스 스케줄러 (단일 레플리카 전제, tripConfirmScheduler와 동일 제약).
// 6시간 간격으로 깨어나되 KST 달력일당 1회만 실제 실행해 알림 중복을 막는다.
const EXPIRY_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastExpiryRunDay = -1;

export function startPointsExpiryScheduler(): NodeJS.Timeout {
  const tick = () => {
    const now = new Date();
    const day = kstDayNumber(now);
    if (day === lastExpiryRunDay) return;
    lastExpiryRunDay = day;
    runPointsExpiryBatch(now).catch((error) =>
      console.error("[pointsExpiryScheduler] run failed:", error)
    );
  };
  const timer = setInterval(tick, EXPIRY_CHECK_INTERVAL_MS);
  timer.unref?.();
  // 부팅 직후 1회 실행 (전일 미처리분 회수).
  setTimeout(tick, 30 * 1000).unref?.();
  console.log("[scheduler] points expiry scheduler started (daily, checked every 6h)");
  return timer;
}
