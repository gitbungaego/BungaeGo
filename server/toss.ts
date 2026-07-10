// Toss Payments core API client (docs.tosspayments.com, 결제위젯 v2 + 코어 API).
//
// TOSS_SECRET_KEY가 없으면 isTossEnabled()가 false를 반환하고 toss 결제수단만
// 비활성화된다 - mock 결제 경로는 이 모듈과 무관하게 항상 동작한다. 라이브
// 전환은 테스트 키(test_gsk_...)를 라이브 키로 교체하는 것으로 끝난다.

const TOSS_API_BASE = "https://api.tosspayments.com";

export function isTossEnabled(): boolean {
  return !!process.env.TOSS_SECRET_KEY;
}

export class TossApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TossApiError";
    this.status = status;
    this.code = code;
  }
}

// The subset of Toss's Payment object we actually read. status values:
// READY / IN_PROGRESS / WAITING_FOR_DEPOSIT / DONE / CANCELED /
// PARTIAL_CANCELED / ABORTED / EXPIRED.
export interface TossPayment {
  paymentKey: string;
  orderId: string;
  status: string;
  totalAmount: number;
  balanceAmount: number;
  method?: string;
  approvedAt?: string;
}

function authHeader(): string {
  // Basic auth: base64("{secretKey}:") - the secret key is the username and
  // the password is empty, per the Toss API reference.
  return `Basic ${Buffer.from(`${process.env.TOSS_SECRET_KEY}:`).toString("base64")}`;
}

async function tossRequest<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; idempotencyKey?: string } = {}
): Promise<T> {
  if (!isTossEnabled()) {
    throw new TossApiError(503, "TOSS_DISABLED", "Toss 결제가 설정되지 않았습니다 (TOSS_SECRET_KEY 없음).");
  }
  const { method = "POST", body, idempotencyKey } = options;

  const headers: Record<string, string> = { Authorization: authHeader() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  // Valid for 15 days per request signature; max 300 chars.
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await fetch(`${TOSS_API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok) {
    throw new TossApiError(
      response.status,
      payload?.code ?? "UNKNOWN",
      payload?.message ?? `Toss API 오류 (HTTP ${response.status})`
    );
  }
  return payload as T;
}

/** 결제 승인. 위젯 인증 후 10분 안에 호출해야 한다. */
export async function confirmTossPayment(input: {
  paymentKey: string;
  orderId: string;
  amount: number;
}): Promise<TossPayment> {
  return tossRequest<TossPayment>("/v1/payments/confirm", {
    body: { paymentKey: input.paymentKey, orderId: input.orderId, amount: input.amount },
  });
}

export interface TossCancelResult {
  payment: TossPayment | null;
  /** 이미 취소된 결제를 재취소한 경우 true - 호출자는 성공으로 간주하면 된다. */
  alreadyCanceled: boolean;
}

/**
 * 결제 취소. cancelAmount를 생략하면 남은 금액 전액 취소, 지정하면 부분취소.
 * 멱등키 필수: 네트워크 오류 후 재시도가 이중 환불이 되지 않도록 한다.
 * 이미 취소된 결제(ALREADY_CANCELED_PAYMENT)는 에러가 아니라 성공으로 처리.
 */
export async function cancelTossPayment(input: {
  paymentKey: string;
  cancelReason: string;
  cancelAmount?: number;
  idempotencyKey: string;
}): Promise<TossCancelResult> {
  try {
    const payment = await tossRequest<TossPayment>(
      `/v1/payments/${encodeURIComponent(input.paymentKey)}/cancel`,
      {
        body: {
          cancelReason: input.cancelReason,
          ...(input.cancelAmount !== undefined ? { cancelAmount: input.cancelAmount } : {}),
        },
        idempotencyKey: input.idempotencyKey,
      }
    );
    return { payment, alreadyCanceled: false };
  } catch (error) {
    if (error instanceof TossApiError && error.code === "ALREADY_CANCELED_PAYMENT") {
      return { payment: null, alreadyCanceled: true };
    }
    throw error;
  }
}

/**
 * 결제 단건 조회. 웹훅 페이로드는 서명이 없으므로 신뢰하지 않고, 수신한
 * paymentKey로 이 API를 호출해 시크릿 키 인증으로 검증된 상태만 사용한다.
 */
export async function fetchTossPayment(paymentKey: string): Promise<TossPayment> {
  return tossRequest<TossPayment>(`/v1/payments/${encodeURIComponent(paymentKey)}`, {
    method: "GET",
  });
}
