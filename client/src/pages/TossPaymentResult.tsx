import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";

// Toss 결제위젯 successUrl/failUrl 랜딩 페이지.
// success: ?paymentKey=&orderId=&amount= → 서버 confirmToss 호출(서버가 금액
// 대조 후 승인 API 호출). fail: ?code=&message=&orderId= → 서버에 실패 기록.

function useQueryParams() {
  // wouter의 useSearch는 렌더 시점 고정이 필요 없으므로 초기 1회만 파싱.
  const [params] = useState(() => new URLSearchParams(window.location.search));
  return params;
}

export function TossPaymentSuccessPage() {
  const [, navigate] = useLocation();
  const params = useQueryParams();
  const startedRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const confirm = trpc.payments.confirmToss.useMutation({
    onSuccess: (result) => {
      navigate(`/reservations/${result.reservationId}/confirm`, { replace: true });
    },
    onError: (err) => setErrorMessage(err.message || "결제 승인에 실패했습니다."),
  });

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const paymentKey = params.get("paymentKey");
    const orderId = params.get("orderId");
    const amount = Number(params.get("amount"));
    if (!paymentKey || !orderId || !Number.isFinite(amount)) {
      setErrorMessage("결제 정보가 올바르지 않습니다.");
      return;
    }
    confirm.mutate({ paymentKey, orderId, amount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (errorMessage) {
    return (
      <div className="py-20 container max-w-md text-center space-y-4">
        <XCircle className="h-12 w-12 mx-auto text-destructive" />
        <h1 className="text-xl font-bold">결제를 완료하지 못했습니다</h1>
        <p className="text-sm text-muted-foreground">{errorMessage}</p>
        <Button asChild className="w-full">
          <Link href="/events">이벤트 목록으로</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="py-20 container max-w-md text-center space-y-4">
      <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin" />
      <h1 className="text-xl font-bold">결제를 확인하고 있습니다</h1>
      <p className="text-sm text-muted-foreground">잠시만 기다려주세요. 창을 닫지 마세요.</p>
    </div>
  );
}

export function TossPaymentFailPage() {
  const params = useQueryParams();
  const startedRef = useRef(false);
  const code = params.get("code") ?? undefined;
  const message = params.get("message") ?? undefined;
  const orderId = params.get("orderId");

  const fail = trpc.payments.failToss.useMutation();

  useEffect(() => {
    if (startedRef.current || !orderId) return;
    startedRef.current = true;
    fail.mutate({ orderId, code, message });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const friendly =
    code === "PAY_PROCESS_CANCELED"
      ? "결제를 취소하셨습니다."
      : message || "결제에 실패했습니다. 다시 시도해주세요.";

  return (
    <div className="py-20 container max-w-md text-center space-y-4">
      <XCircle className="h-12 w-12 mx-auto text-destructive" />
      <h1 className="text-xl font-bold">결제가 완료되지 않았습니다</h1>
      <p className="text-sm text-muted-foreground">{friendly}</p>
      {code && <p className="text-xs text-muted-foreground/70">오류 코드: {code}</p>}
      <div className="flex flex-col gap-2">
        <Button variant="outline" onClick={() => window.history.back()} className="w-full">
          이전 화면으로 돌아가기
        </Button>
        <Button asChild className="w-full">
          <Link href="/events">이벤트 목록으로</Link>
        </Button>
      </div>
    </div>
  );
}

// 라우터 편의를 위한 default export (성공 페이지가 주 진입점).
export default function TossPaymentResultPage({ mode }: { mode: "success" | "fail" }) {
  return mode === "success" ? <TossPaymentSuccessPage /> : <TossPaymentFailPage />;
}
