// Toss Payments 결제위젯 v2 SDK 로더 (docs.tosspayments.com/sdk/v2/js).
// Kakao 지도 SDK와 같은 동적 스크립트 로드 패턴. 클라이언트 키가 없으면
// toss 결제수단 UI 자체가 노출되지 않는다 (mock 결제는 항상 동작).

const SDK_URL = "https://js.tosspayments.com/v2/standard";

export const TOSS_CLIENT_KEY: string = import.meta.env.VITE_TOSS_CLIENT_KEY ?? "";

export function isTossConfigured(): boolean {
  return !!TOSS_CLIENT_KEY;
}

declare global {
  interface Window {
    TossPayments?: any;
  }
}

let sdkPromise: Promise<any> | null = null;

function loadSdk(): Promise<any> {
  if (window.TossPayments) return Promise.resolve(window.TossPayments);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => {
      if (window.TossPayments) resolve(window.TossPayments);
      else reject(new Error("TossPayments SDK가 로드되지 않았습니다."));
    };
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("TossPayments SDK 로드에 실패했습니다."));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export interface TossWidgets {
  setAmount(amount: { currency: "KRW"; value: number }): Promise<void>;
  renderPaymentMethods(options: { selector: string; variantKey?: string }): Promise<any>;
  renderAgreement(options: { selector: string }): Promise<any>;
  requestPayment(options: {
    orderId: string;
    orderName: string;
    successUrl: string;
    failUrl: string;
    customerName?: string;
    customerEmail?: string;
  }): Promise<void>;
}

/** 비회원(ANONYMOUS) 키 기반 위젯 인스턴스 생성. */
export async function createTossWidgets(): Promise<TossWidgets> {
  if (!isTossConfigured()) throw new Error("토스 클라이언트 키가 설정되지 않았습니다.");
  const TossPayments = await loadSdk();
  const tossPayments = TossPayments(TOSS_CLIENT_KEY);
  return tossPayments.widgets({ customerKey: TossPayments.ANONYMOUS });
}

export const TOSS_SUCCESS_PATH = "/payments/toss/success";
export const TOSS_FAIL_PATH = "/payments/toss/fail";
