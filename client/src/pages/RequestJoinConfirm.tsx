import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice, formatDateTime } from "@/lib/constants";
import { Clock, Hourglass } from "lucide-react";
import { Link } from "wouter";

interface Props {
  requestId: number;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "매칭 대기 중",
  clustered: "매칭 진행 중",
  route_confirmed: "배차 확정!",
  boarded: "탑승 완료",
  failed_refunded: "매칭 실패 (환불됨)",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-50 text-amber-600 border-amber-200",
  clustered: "bg-blue-50 text-blue-600 border-blue-200",
  route_confirmed: "bg-emerald-50 text-emerald-600 border-emerald-200",
  boarded: "bg-emerald-50 text-emerald-600 border-emerald-200",
  failed_refunded: "bg-red-50 text-red-500 border-red-200",
};

export default function RequestJoinConfirmPage({ requestId }: Props) {
  const { data: request, isLoading } = trpc.rideRequests.byId.useQuery({ id: requestId });
  const { data: event } = trpc.events.byId.useQuery(
    { id: request?.eventId ?? 0 },
    { enabled: !!request }
  );

  if (isLoading) {
    return (
      <div className="py-10 container max-w-lg">
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (!request) {
    return <div className="py-20 text-center text-muted-foreground">신청 정보를 찾을 수 없습니다.</div>;
  }

  return (
    <div className="py-12">
      <div className="container max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 mb-4">
            <Hourglass className="h-8 w-8 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold mb-2">참가 신청이 접수되었습니다!</h1>
          <p className="text-muted-foreground text-sm">신청 번호: #{request.id}</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 space-y-4 mb-6">
          {event && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">이벤트</p>
              <p className="font-semibold">{event.title}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground mb-1">참가자</p>
              <p className="font-medium">{request.passengerName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">좌석 수</p>
              <p className="font-medium">{request.seats}명</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground mb-1">출발지</p>
              <p className="font-medium">{request.originAddress ?? "—"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Clock className="h-3 w-3" /> 도착 희망 시각
              </p>
              <p className="font-medium">{formatDateTime(request.targetArrivalAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">결제 금액</p>
              <p className="font-bold text-primary">{formatPrice(request.totalAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">상태</p>
              <Badge variant="outline" className={`text-xs ${STATUS_COLORS[request.status] ?? ""}`}>
                {STATUS_LABELS[request.status] ?? request.status}
              </Badge>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700 mb-6">
          비슷한 출발지·시간대의 참가자들과 함께 자동으로 정류장과 노선이 배정됩니다.
          배차가 확정되면 마이페이지에서 확인할 수 있습니다.
        </div>

        <div className="flex flex-col gap-3">
          <Button asChild>
            <Link href="/mypage">내 신청 내역 확인하기</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/events">다른 이벤트 보기</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
