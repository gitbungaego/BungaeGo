import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice, formatDateTime, RESERVATION_STATUS_LABELS, TICKET_TYPE_LABELS } from "@/lib/constants";
import { CheckCircle2, Bus, Calendar, MapPin, Users } from "lucide-react";
import { Link } from "wouter";

interface Props {
  reservationId: number;
}

export default function BookingConfirmPage({ reservationId }: Props) {
  const { data: reservation, isLoading } = trpc.reservations.byId.useQuery({ id: reservationId });
  const { data: trip } = trpc.trips.byId.useQuery(
    { id: reservation?.tripId ?? 0 },
    { enabled: !!reservation }
  );
  const { data: event } = trpc.events.byId.useQuery(
    { id: trip?.eventId ?? 0 },
    { enabled: !!trip }
  );
  const { data: boardingPoints } = trpc.boardingPoints.byTripId.useQuery(
    { tripId: reservation?.tripId ?? 0 },
    { enabled: !!reservation }
  );

  if (isLoading) {
    return (
      <div className="py-10 container max-w-lg">
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (!reservation) {
    return <div className="py-20 text-center text-muted-foreground">예약 정보를 찾을 수 없습니다.</div>;
  }

  const boardingPoint = boardingPoints?.find((b) => b.id === reservation.boardingPointId);

  return (
    <div className="py-12">
      <div className="container max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold mb-2">예약이 완료되었습니다!</h1>
          <p className="text-muted-foreground text-sm">예약 번호: #{reservation.id}</p>
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
              <p className="text-xs text-muted-foreground mb-1">예약자</p>
              <p className="font-medium">{reservation.passengerName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">좌석 수</p>
              <p className="font-medium">{reservation.seats}명</p>
            </div>
            {/* 편도 셔틀의 round(전 구간)는 표기 생략 — 왕복 셔틀에서만 의미가 있다. */}
            {(reservation.ticketType !== "round" || trip?.isRoundTrip) && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">탑승권</p>
                <p className="font-medium">{TICKET_TYPE_LABELS[reservation.ticketType] ?? reservation.ticketType}</p>
              </div>
            )}
            {boardingPoint && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground mb-1">탑승 포인트</p>
                <p className="font-medium">{boardingPoint.name}</p>
              </div>
            )}
            {trip && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground mb-1">출발 시간</p>
                <p className="font-medium">{formatDateTime(trip.departureAt)}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-1">결제 금액</p>
              <p className="font-bold text-primary">{formatPrice(reservation.totalAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">상태</p>
              <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-600 border-emerald-200">
                {RESERVATION_STATUS_LABELS[reservation.status] ?? reservation.status}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Button asChild>
            <Link href="/mypage">내 예약 확인하기</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/events">다른 이벤트 보기</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
