import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice, formatDateTime } from "@/lib/constants";
import { CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { useT } from "@/i18n";

interface Props {
  reservationId: number;
}

export default function BookingConfirmPage({ reservationId }: Props) {
  const t = useT();
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
    return <div className="py-20 text-center text-muted-foreground">{t("bookingConfirm.notFound")}</div>;
  }

  const boardingPoint = boardingPoints?.find((b) => b.id === reservation.boardingPointId);

  return (
    <div className="py-12">
      <div className="container max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold mb-2">{t("bookingConfirm.done")}</h1>
          <p className="text-muted-foreground text-sm">{t("bookingConfirm.resNo", { id: reservation.id })}</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 space-y-4 mb-6">
          {event && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("field.event")}</p>
              <p className="font-semibold">{event.title}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("field.passenger")}</p>
              <p className="font-medium">{reservation.passengerName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("field.seats")}</p>
              <p className="font-medium">{t("common.seats", { n: reservation.seats })}</p>
            </div>
            {/* 편도 셔틀의 round(전 구간)는 표기 생략 — 왕복 셔틀에서만 의미가 있다. */}
            {(reservation.ticketType !== "round" || trip?.isRoundTrip) && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("field.ticket")}</p>
                <p className="font-medium">{t(`ticket.${reservation.ticketType}`)}</p>
              </div>
            )}
            {boardingPoint && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground mb-1">{t("field.boardingPoint")}</p>
                <p className="font-medium">{boardingPoint.name}</p>
              </div>
            )}
            {trip && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground mb-1">{t("field.departTime")}</p>
                <p className="font-medium">{formatDateTime(trip.departureAt)}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("field.amount")}</p>
              <p className="font-bold text-primary">{formatPrice(reservation.totalAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("field.status")}</p>
              <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-600 border-emerald-200">
                {t(`resv.${reservation.status}`)}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Button asChild>
            <Link href="/mypage">{t("bookingConfirm.viewMy")}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/events">{t("bookingConfirm.viewOthers")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
