import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  TRIP_STATUS_COLORS,
  TRIP_STATUS_LABELS,
  formatDate,
  formatDateTime,
  formatPrice,
  formatTime,
} from "@/lib/constants";
import { ArrowLeft, Bus, Calendar, Clock, MapPin, Users } from "lucide-react";
import { Link, useLocation } from "wouter";
import { MapView } from "@/components/Map";
import { useState, useCallback } from "react";

interface Props {
  id: number;
}

export default function EventDetailPage({ id }: Props) {
  const [, navigate] = useLocation();
  const { data: event, isLoading: eventLoading } = trpc.events.byId.useQuery({ id });
  const { data: trips, isLoading: tripsLoading } = trpc.trips.byEventId.useQuery({ eventId: id });
  const [mapReady, setMapReady] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);

  const selectedTrip = trips?.find((t) => t.id === selectedTripId) ?? trips?.[0];

  const { data: boardingPoints } = trpc.boardingPoints.byTripId.useQuery(
    { tripId: selectedTrip?.id ?? 0 },
    { enabled: !!selectedTrip }
  );

  const handleMapReady = useCallback((map: google.maps.Map) => {
    setMapReady(true);
    if (boardingPoints && boardingPoints.length > 0) {
      boardingPoints.forEach((bp) => {
        if (bp.lat && bp.lng) {
          new google.maps.Marker({
            position: { lat: Number(bp.lat), lng: Number(bp.lng) },
            map,
            title: bp.name,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: "#5B4DFF",
              fillOpacity: 1,
              strokeColor: "#fff",
              strokeWeight: 2,
            },
          });
        }
      });
    }
  }, [boardingPoints]);

  if (eventLoading) {
    return (
      <div className="py-10">
        <div className="container max-w-4xl">
          <Skeleton className="h-64 w-full rounded-2xl mb-6" />
          <Skeleton className="h-8 w-2/3 mb-3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        이벤트를 찾을 수 없습니다.
      </div>
    );
  }

  return (
    <div className="py-8">
      <div className="container max-w-5xl">
        {/* Back */}
        <Link href="/events" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          이벤트 목록
        </Link>

        {/* Hero */}
        <div className="rounded-2xl overflow-hidden border border-border mb-8 bg-card">
          {event.imageUrl && (
            <div className="relative h-56 sm:h-72 overflow-hidden">
              <img
                src={event.imageUrl}
                alt={event.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <div className="absolute bottom-4 left-5 right-5">
                <Badge
                  variant="outline"
                  className={`text-xs font-medium border mb-2 ${CATEGORY_COLORS[event.category] ?? ""} bg-white/90`}
                >
                  {CATEGORY_LABELS[event.category] ?? event.category}
                </Badge>
                <h1 className="text-white text-xl sm:text-2xl font-bold leading-tight">
                  {event.title}
                </h1>
              </div>
            </div>
          )}
          <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {!event.imageUrl && (
              <div className="sm:col-span-3">
                <Badge variant="outline" className={`text-xs font-medium border mb-2 ${CATEGORY_COLORS[event.category] ?? ""}`}>
                  {CATEGORY_LABELS[event.category] ?? event.category}
                </Badge>
                <h1 className="text-2xl font-bold">{event.title}</h1>
              </div>
            )}
            <div className="flex items-start gap-2.5 text-sm">
              <Calendar className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">{formatDate(event.eventDate)}</p>
                <p className="text-muted-foreground text-xs">{formatTime(event.eventDate)}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 text-sm">
              <MapPin className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">{event.venue}</p>
                {event.address && <p className="text-muted-foreground text-xs">{event.address}</p>}
              </div>
            </div>
            {event.organizerName && (
              <div className="flex items-start gap-2.5 text-sm">
                <Users className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">{event.organizerName}</p>
                  <p className="text-muted-foreground text-xs">주최</p>
                </div>
              </div>
            )}
            {event.description && (
              <p className="sm:col-span-3 text-sm text-muted-foreground leading-relaxed border-t border-border/60 pt-4 mt-1">
                {event.description}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Trips */}
          <div className="lg:col-span-3 space-y-4">
            <h2 className="text-lg font-semibold">셔틀 목록</h2>
            {tripsLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
              </div>
            ) : trips && trips.length > 0 ? (
              <div className="space-y-3">
                {trips.map((trip) => {
                  const pct = Math.min(100, Math.round((trip.currentCount / trip.maxCount) * 100));
                  const isConfirmed = trip.status === "confirmed";
                  const isFull = trip.currentCount >= trip.maxCount;
                  const isSelected = selectedTrip?.id === trip.id;

                  return (
                    <div
                      key={trip.id}
                      onClick={() => setSelectedTripId(trip.id)}
                      className={`rounded-xl border p-4 cursor-pointer transition-all duration-200 ${
                        isSelected
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border bg-card hover:border-primary/40 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs">
                            {trip.mode === "bus" ? "🚌 버스" : "🚐 밴"}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`text-xs border ${TRIP_STATUS_COLORS[trip.status] ?? ""}`}
                          >
                            {isConfirmed ? "✅ 확정됨!" : TRIP_STATUS_LABELS[trip.status]}
                          </Badge>
                          {trip.isRoundTrip && (
                            <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">
                              왕복
                            </Badge>
                          )}
                        </div>
                        <span className="text-base font-bold text-primary whitespace-nowrap">
                          {formatPrice(trip.price)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                        <Clock className="h-3.5 w-3.5" />
                        <span>출발 {formatDateTime(trip.departureAt)}</span>
                      </div>

                      {/* Progress */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            <span className="font-semibold text-foreground">{trip.currentCount}</span>
                            /{trip.maxCount}명
                          </span>
                          <span className={`font-medium ${isConfirmed ? "text-emerald-600" : "text-muted-foreground"}`}>
                            최소 {trip.minCount}명 {isConfirmed ? "달성!" : "필요"}
                          </span>
                        </div>
                        <Progress value={pct} className="h-2" />
                      </div>

                      {trip.notes && (
                        <p className="text-xs text-muted-foreground mt-2 border-t border-border/60 pt-2">
                          {trip.notes}
                        </p>
                      )}

                      <div className="mt-3">
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={isFull || trip.status === "cancelled"}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/trips/${trip.id}/book`);
                          }}
                        >
                          {isFull ? "마감됨" : trip.status === "cancelled" ? "취소됨" : "예약하기"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-xl">
                <Bus className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">아직 셔틀이 없습니다</p>
                <Button variant="outline" size="sm" className="mt-3" asChild>
                  <Link href="/create">셔틀 만들기</Link>
                </Button>
              </div>
            )}
          </div>

          {/* Map + Boarding Points */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-lg font-semibold">탑승 포인트</h2>

            {/* Map */}
            <div className="rounded-xl overflow-hidden border border-border h-48">
              <MapView
                onMapReady={handleMapReady}
                initialCenter={
                  event.lat && event.lng
                    ? { lat: Number(event.lat), lng: Number(event.lng) }
                    : { lat: 37.5155, lng: 127.0726 }
                }
                initialZoom={12}
              />
            </div>

            {/* Boarding Points List */}
            {boardingPoints && boardingPoints.length > 0 ? (
              <div className="space-y-2">
                {boardingPoints.map((bp, idx) => (
                  <div
                    key={bp.id}
                    className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card"
                  >
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white text-xs font-bold flex-shrink-0 mt-0.5">
                      {idx + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{bp.name}</p>
                      {bp.address && (
                        <p className="text-xs text-muted-foreground truncate">{bp.address}</p>
                      )}
                      {bp.pickupTime && (
                        <p className="text-xs text-primary mt-0.5">
                          픽업 {formatTime(bp.pickupTime)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                셔틀을 선택하면 탑승 포인트가 표시됩니다
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
