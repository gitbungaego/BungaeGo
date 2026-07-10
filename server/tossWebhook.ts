import type { Express, Request, Response } from "express";
import { getPaymentByOrderId, updatePaymentStatus } from "./db";
import { fetchTossPayment, isTossEnabled } from "./toss";

// Toss 웹훅에는 서명(시크릿) 헤더가 없다. 따라서 페이로드를 신뢰하지 않고,
// 수신한 paymentKey로 결제 조회 API(시크릿 키 Basic 인증)를 호출해 검증된
// 상태만 사용한다 - 위조된 웹훅은 조회 결과와 orderId가 매칭되지 않거나
// 우리 DB에 없는 주문이라 아무 상태도 바꾸지 못한다.

interface WebhookOutcome {
  status: number;
  body: { ok: boolean; note?: string };
}

/**
 * 멱등 상태 전이: 같은 이벤트가 중복 수신돼도 전이는 한 번만 일어난다
 * (현재 상태를 먼저 확인하고, 이미 목표 상태면 no-op).
 *
 * - Toss CANCELED + 우리 paid → cancelled (외부/대시보드 취소 동기화)
 * - Toss ABORTED/EXPIRED + 우리 pending → cancelled(payment_failed)
 * - Toss DONE + 우리 pending → 전이하지 않음 (confirmToss가 예약 확정까지
 *   책임지는 경로라, 웹훅이 먼저 paid로 만들면 예약 없는 결제가 된다)
 */
export async function handleTossWebhookEvent(body: any): Promise<WebhookOutcome> {
  const eventType = body?.eventType;
  const paymentKey = body?.data?.paymentKey;

  if (eventType !== "PAYMENT_STATUS_CHANGED" || typeof paymentKey !== "string" || !paymentKey) {
    return { status: 200, body: { ok: true, note: "ignored" } };
  }
  if (!isTossEnabled()) {
    return { status: 200, body: { ok: true, note: "toss disabled" } };
  }

  // 검증 조회 실패(네트워크 등)는 5xx로 응답해 Toss가 재전송하게 한다.
  let verified;
  try {
    verified = await fetchTossPayment(paymentKey);
  } catch (error) {
    console.error("[tossWebhook] payment verification fetch failed:", error);
    return { status: 500, body: { ok: false, note: "verification failed" } };
  }

  const payment = await getPaymentByOrderId(verified.orderId);
  if (!payment || payment.method !== "toss") {
    return { status: 200, body: { ok: true, note: "unknown order" } };
  }

  if (verified.status === "CANCELED" && payment.status === "paid") {
    await updatePaymentStatus(payment.id, "cancelled", {
      cancelledAt: new Date(),
      cancelNote: "토스 웹훅: 결제 취소 동기화",
    });
    return { status: 200, body: { ok: true, note: "synced cancel" } };
  }

  if ((verified.status === "ABORTED" || verified.status === "EXPIRED") && payment.status === "pending") {
    await updatePaymentStatus(payment.id, "cancelled", {
      cancelledAt: new Date(),
      cancelReason: "payment_failed",
      cancelNote: `토스 웹훅: 결제 ${verified.status}`,
    });
    return { status: 200, body: { ok: true, note: "synced failure" } };
  }

  if (verified.status === "DONE" && payment.status === "pending") {
    // confirmToss가 아직 확정 전이거나 서버가 승인 직후 죽은 경우. 자동
    // 확정은 예약 생성까지 얽혀 있어 웹훅에서 하지 않고 로그만 남긴다.
    console.warn(`[tossWebhook] DONE received for still-pending order ${verified.orderId} (payment ${payment.id})`);
  }

  return { status: 200, body: { ok: true } };
}

// /api/webhooks/toss - Toss는 10초 내 200 응답을 요구하고, 비-200이면
// 지수 백오프로 최대 7회 재전송한다. writeMutationRateLimiter는 /api/trpc
// 에만 마운트되어 있어 이 경로에는 적용되지 않는다 (globalRateLimiter만
// 적용되며, Toss 재전송 빈도로는 도달하지 않는 수준).
export function registerTossWebhook(app: Express): void {
  app.post("/api/webhooks/toss", async (req: Request, res: Response) => {
    try {
      const outcome = await handleTossWebhookEvent(req.body);
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      console.error("[tossWebhook] handler failed:", error);
      res.status(500).json({ ok: false });
    }
  });
}
