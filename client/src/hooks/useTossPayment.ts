import { useEffect, useRef, useState } from "react";
import {
  createTossWidgets,
  isTossConfigured,
  TOSS_FAIL_PATH,
  TOSS_SUCCESS_PATH,
  type TossWidgets,
} from "@/lib/toss";

export const TOSS_METHODS_SELECTOR = "#toss-payment-methods";
export const TOSS_AGREEMENT_SELECTOR = "#toss-agreement";

export interface TossPaymentOrder {
  orderId: string;
  orderName: string;
  /** 서버가 계산한 최종 결제 금액 - 위젯 표시 금액과 다르면 이 값으로 맞춘다. */
  amount: number;
  customerName?: string;
  customerEmail?: string;
}

/**
 * 결제위젯 v2 훅. `enabled`가 되면 TOSS_METHODS_SELECTOR /
 * TOSS_AGREEMENT_SELECTOR 컨테이너에 위젯을 렌더하고, `amount` 변경을
 * setAmount로 동기화한다. requestPayment는 successUrl/failUrl 리다이렉트
 * 방식으로 결제창을 연다.
 */
export function useTossPayment({ enabled, amount }: { enabled: boolean; amount: number }) {
  const widgetsRef = useRef<TossWidgets | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !isTossConfigured() || widgetsRef.current) return;
    let disposed = false;
    (async () => {
      const widgets = await createTossWidgets();
      if (disposed) return;
      widgetsRef.current = widgets;
      await widgets.setAmount({ currency: "KRW", value: amount });
      await widgets.renderPaymentMethods({ selector: TOSS_METHODS_SELECTOR });
      await widgets.renderAgreement({ selector: TOSS_AGREEMENT_SELECTOR });
      if (!disposed) setReady(true);
    })().catch((err) => {
      if (!disposed) setError(err instanceof Error ? err.message : "결제위젯 로드에 실패했습니다.");
    });
    return () => {
      disposed = true;
    };
    // amount 변경은 아래 effect가 setAmount로 처리한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!ready) return;
    widgetsRef.current?.setAmount({ currency: "KRW", value: amount }).catch(() => {});
  }, [amount, ready]);

  const requestPayment = async (order: TossPaymentOrder) => {
    const widgets = widgetsRef.current;
    if (!widgets) throw new Error("결제위젯이 준비되지 않았습니다.");
    if (order.amount !== amount) {
      await widgets.setAmount({ currency: "KRW", value: order.amount });
    }
    await widgets.requestPayment({
      orderId: order.orderId,
      orderName: order.orderName,
      successUrl: `${window.location.origin}${TOSS_SUCCESS_PATH}`,
      failUrl: `${window.location.origin}${TOSS_FAIL_PATH}`,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
    });
  };

  return { ready, error, requestPayment };
}
