import { TRPCError } from "@trpc/server";
import { getReservationsWithPaymentsByTripId, getTripById } from "../db";
import type { Trip } from "../../drizzle/schema";

// 번개팅 회차 접근제어 공용 검증 (spec §3-4, §3-6). 프로필 공개(participants)와
// 채팅(입장·조회·전송)이 동일 기준을 공유한다 — 복붙 금지, 이 함수 하나로 강제.
//
// 검증: (b) 요청자가 그 트립의 유효(비취소) 예약자 본인  (c) 트립이 confirmed.
// (a) 로그인은 bungaetingProcedure(protectedProcedure 기반)가 상위에서 이미 강제.
//
// 순서: 멤버십 먼저 → 확정 여부. 비참가자에겐 트립 상태조차 흘리지 않고, 참가자에겐
// "확정 후" 안내를 준다.
export async function loadConfirmedTripMembership(
  tripId: number,
  userId: number
): Promise<{ trip: Trip; activeUserIds: Set<number> }> {
  const trip = await getTripById(tripId);
  if (!trip || trip.theme !== "bungaeting") {
    throw new TRPCError({ code: "NOT_FOUND", message: "번개팅 회차를 찾을 수 없습니다." });
  }

  const reservations = await getReservationsWithPaymentsByTripId(tripId);
  const activeUserIds = new Set(
    reservations.filter((r) => r.status !== "cancelled").map((r) => r.userId)
  );

  // (b) 유효 예약자 본인만 (reservations 조인으로 확인 — tripId만으론 불충분).
  if (!activeUserIds.has(userId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "이 회차의 참가자만 이용할 수 있습니다." });
  }

  // (c) 확정(D-5) 후에만 — 결제·확정 전 열람/입장 금지 (프로필 쇼핑 방지).
  if (trip.status !== "confirmed") {
    throw new TRPCError({ code: "FORBIDDEN", message: "회차 확정 후 이용할 수 있습니다." });
  }

  return { trip, activeUserIds };
}
