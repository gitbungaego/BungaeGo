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
import { MapView, createBoardingPointMarker, createDemandCircle, createDotMarker } from "@/components/Map";
import { MapPointSheet, type MapPointSelection } from "@/components/MapPointSheet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Props {
  id: number;
}

// Demand circle radius scales with rider count in a grid cell, clamped so a
// single request is still visible and a large cluster doesn't swallow the map.
const MIN_DEMAND_RADIUS_M = 250;
const MAX_DEMAND_RADIUS_M = 1200;
const RADIUS_STEP_PER_RIDER_M = 150;

function demandRadiusMeters(count: number): number {
  return Math.min(MAX_DEMAND_RADIUS_M, MIN_DEMAND_RADIUS_M + (count - 1) * RADIUS_STEP_PER_RIDER_M);
}

// Distinct from the yellow (boarding points/demand) and gray (muted boarding
// points) already in use, so confirmed-vs-unconfirmed rally point candidates
// read as their own category rather than blending into either.
const CANDIDATE_CONFIRMED_COLOR = "#0284C7";
const CANDIDATE_UNCONFIRMED_COLOR = "#BAE6FD";
const NEARBY_DEMAND_RADIUS_METERS = 1500;

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radius = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export default function EventDetailPage({ id }: Props) {
  const [, navigate] = useLocation();
  const { data: event, isLoading: eventLoading } = trpc.events.byId.useQuery({ id });
  const { data: trips, isLoading: tripsLoading } = trpc.trips.byEventId.useQuery({ eventId: id });
  const { data: allBoardingPoints } = trpc.boardingPoints.byEventId.useQuery({ eventId: id });
  const { data: demandCells } = trpc.rideRequests.demandByEvent.useQuery(
    { eventId: id },
    { enabled: !!event?.autoMatchEnabled }
  );
  const { data: rallyPointCandidates } = trpc.rallyPointCandidates.list.useQuery(
    undefined,
    { enabled: !!event?.autoMatchEnabled }
  );

  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [map, setMap] = useState<any>(null);
  const [selectedMapPoint, setSelectedMapPoint] = useState<MapPointSelection | null>(null);
  const markersRef = useRef<any[]>([]);
  const demandMarkersRef = useRef<any[]>([]);
  const candidateMarkersRef = useRef<any[]>([]);
  const boardingClustererRef = useRef<any>(null);
  const candidateClustererRef = useRef<any>(null);

  const { data: selectedBoardingDetail, isLoading: selectedBoardingLoading } =
    trpc.boardingPoints.detailById.useQuery(
      { boardingPointId: selectedMapPoint?.type === "boarding" ? selectedMapPoint.boardingPointId : 0 },
      { enabled: selectedMapPoint?.type === "boarding" }
    );

  const selectedTrip = trips?.find((t) => t.id === selectedTripId) ?? trips?.[0];

  const selectedTripPoints = useMemo(
    () => (allBoardingPoints ?? []).filter((bp) => bp.tripId === selectedTrip?.id),
    [allBoardingPoints, selectedTrip?.id]
  );

  const nearbyDemandFor = useCallback(
    (position: { lat: number; lng: number }) =>
      (demandCells ?? []).reduce(
        (summary, cell) => {
          if (distanceMeters(position, { lat: cell.lat, lng: cell.lng }) > NEARBY_DEMAND_RADIUS_METERS) {
            return summary;
          }
          return { count: summary.count + cell.count, seats: summary.seats + cell.seats };
        },
        { count: 0, seats: 0 }
      ),
    [demandCells]
  );

  const handleMapReady = useCallback((m: any) => {
    setMap(m);
  }, []);

  const selectBoardingPointFromMarker = useCallback((boardingPointId: number, tripId: number) => {
    setSelectedTripId(tripId);
    setSelectedMapPoint({ type: "boarding", boardingPointId });
  }, []);

  // Event-wide rally-point layer: the venue plus every trip's boarding
  // points, re-rendered whenever the map instance, the point list, or the
  // selected trip changes (not just once at map init). The demand and rally
  // point candidate layers below follow this same shape - their own effect +
  // marker-ref array drawn on the same `map` instance.
  useEffect(() => {
    if (!map || !window.kakao || !event) return;

    boardingClustererRef.current?.clear();
    boardingClustererRef.current = null;
    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];
    const clusterableBoardingMarkers: any[] = [];

    const bounds = new window.kakao.maps.LatLngBounds();
    let hasBounds = false;

    if (event.lat && event.lng) {
      const venuePosition = new window.kakao.maps.LatLng(Number(event.lat), Number(event.lng));
      const venueMarker = new window.kakao.maps.Marker({
        position: venuePosition,
        map,
        title: `${event.venue} (도착지)`,
      });
      markersRef.current.push(venueMarker);
      bounds.extend(venuePosition);
      hasBounds = true;
    }

    (allBoardingPoints ?? []).forEach((bp) => {
      if (!bp.lat || !bp.lng) return;
      const isSelected = bp.tripId === selectedTrip?.id;
      const orderIndex = isSelected
        ? selectedTripPoints.findIndex((point) => point.id === bp.id) + 1
        : undefined;

      const marker = createBoardingPointMarker(
        map,
        { lat: Number(bp.lat), lng: Number(bp.lng) },
        {
          label: orderIndex ? String(orderIndex) : undefined,
          muted: !isSelected,
          title: bp.name,
          onClick: () => selectBoardingPointFromMarker(bp.id, bp.tripId),
        }
      );
      markersRef.current.push(marker);
      clusterableBoardingMarkers.push(marker);
      bounds.extend(new window.kakao.maps.LatLng(Number(bp.lat), Number(bp.lng)));
      hasBounds = true;
    });

    if (hasBounds) {
      map.setBounds(bounds);
    }

    if (clusterableBoardingMarkers.length > 0 && window.kakao.maps.MarkerClusterer) {
      boardingClustererRef.current = new window.kakao.maps.MarkerClusterer({
        map,
        markers: clusterableBoardingMarkers,
        minLevel: 6,
        minClusterSize: 3,
        averageCenter: true,
      });
    }
  }, [map, allBoardingPoints, selectedTrip?.id, selectedTripPoints, event, selectBoardingPointFromMarker]);

  // Demand layer: one translucent circle per grid cell, radius scaled by
  // rider count. Always shown alongside the rally-point layer above when the
  // event auto-matches - no visibility toggle, per current data scale.
  useEffect(() => {
    if (!map || !window.kakao) return;

    demandMarkersRef.current.forEach((circle) => circle.setMap(null));
    demandMarkersRef.current = [];
    (demandCells ?? []).forEach((cell) => {
      const circle = createDemandCircle(
        map,
        { lat: cell.lat, lng: cell.lng },
        {
          radiusMeters: demandRadiusMeters(cell.count),
          onClick: () => {
            setSelectedMapPoint({
              type: "demand",
              lat: cell.lat,
              lng: cell.lng,
              count: cell.count,
              seats: cell.seats,
            });
          },
        }
      );
      demandMarkersRef.current.push(circle);
    });
  }, [map, demandCells]);

  // Rally point candidate layer: every active candidate, dark dot when its
  // bus access is confirmed, pale dot while unconfirmed. Only busAccessible
  // ones are ever offered to the matching pipeline as snap targets - this
  // layer shows both so unconfirmed suggestions stay visible on the map.
  useEffect(() => {
    if (!map || !window.kakao || !event) return;

    candidateClustererRef.current?.clear();
    candidateClustererRef.current = null;
    candidateMarkersRef.current.forEach((marker) => marker.setMap(null));
    candidateMarkersRef.current = [];

    (rallyPointCandidates ?? []).forEach((candidate) => {
      const confirmed = candidate.busAccessible;
      const lat = Number(candidate.lat);
      const lng = Number(candidate.lng);
      const marker = createDotMarker(
        map,
        { lat, lng },
        confirmed ? CANDIDATE_CONFIRMED_COLOR : CANDIDATE_UNCONFIRMED_COLOR,
        `${candidate.name} · ${confirmed ? "정차 확인됨" : "정차 확인 중"}`,
        () => {
          setSelectedMapPoint({
            type: "candidate",
            id: candidate.id,
            eventId: event.id,
            name: candidate.name,
            region: candidate.region,
            lat,
            lng,
            busAccessible: candidate.busAccessible,
            notes: candidate.notes,
            nearbyDemand: nearbyDemandFor({ lat, lng }),
            autoMatchEnabled: !!event.autoMatchEnabled && !event.matchingFrozenAt,
          });
        }
      );
      candidateMarkersRef.current.push(marker);
    });

    if (candidateMarkersRef.current.length > 0 && window.kakao.maps.MarkerClusterer) {
      candidateClustererRef.current = new window.kakao.maps.MarkerClusterer({
        map,
        markers: candidateMarkersRef.current,
        minLevel: 6,
        minClusterSize: 3,
        averageCenter: true,
      });
    }
  }, [map, rallyPointCandidates, event, nearbyDemandFor]);

  // Belt-and-suspenders cleanup on unmount (each effect above already clears
  // its own markers at the start of every re-run).
  useEffect(() => {
    return () => {
      boardingClustererRef.current?.clear();
      candidateClustererRef.current?.clear();
      markersRef.current.forEach((marker) => marker.setMap(null));
      demandMarkersRef.current.forEach((circle) => circle.setMap(null));
      candidateMarkersRef.current.forEach((marker) => marker.setMap(null));
    };
  }, []);

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

  const hasBoardingPoints = (allBoardingPoints?.length ?? 0) > 0;
  const hasDemand = (demandCells?.length ?? 0) > 0;
  const showEmptyMapOverlay = !hasBoardingPoints && !hasDemand;
  const showJoinCta = event.autoMatchEnabled && !event.matchingFrozenAt;

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

        {event.autoMatchEnabled && !event.matchingFrozenAt && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 mb-6 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-semibold">출발지·시간에 맞춰 자동으로 배차됩니다</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                참가 신청하면 비슷한 경로의 참가자와 함께 최적의 정류장·노선으로 매칭됩니다.
              </p>
            </div>
            <Button asChild>
              <Link href={`/events/${event.id}/join`}>참가 신청하기</Link>
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Map + Boarding Points - map-first: leads on mobile, sticky+wider on desktop */}
          <div className="lg:col-span-3 space-y-4 lg:sticky lg:top-20 lg:self-start">
            <h2 className="text-lg font-semibold">탑승 포인트</h2>

            <div className="relative rounded-xl overflow-hidden border border-border h-[40vh] lg:h-[480px]">
              <MapView
                className="h-full"
                onMapReady={handleMapReady}
                initialCenter={
                  event.lat && event.lng
                    ? { lat: Number(event.lat), lng: Number(event.lng) }
                    : { lat: 37.5155, lng: 127.0726 }
                }
                initialZoom={12}
              />
              {showEmptyMapOverlay && (
                <div className="absolute inset-0 flex items-end sm:items-center justify-center bg-gradient-to-t from-black/50 via-black/10 to-transparent p-4 pointer-events-none">
                  <div className="pointer-events-auto bg-white rounded-xl border border-border shadow-lg p-4 max-w-sm w-full text-center space-y-2">
                    <p className="text-sm font-medium">아직 랠리 포인트가 없어요</p>
                    <p className="text-xs text-muted-foreground">
                      {event.autoMatchEnabled
                        ? "참가 신청하면 출발지 수요에 따라 정류장이 만들어집니다."
                        : "셔틀을 만들면 탑승 포인트를 등록할 수 있어요."}
                    </p>
                    <Button size="sm" className="w-full" asChild>
                      {event.autoMatchEnabled ? (
                        <Link href={`/events/${event.id}/join`}>참가 신청하기</Link>
                      ) : (
                        <Link href="/create">셔틀 만들기</Link>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {showJoinCta && (
                <div className="absolute bottom-3 right-3 z-10">
                  <Button asChild size="sm" className="rounded-full shadow-lg">
                    <Link href={`/events/${event.id}/join`}>🙋 나도 여기서 출발할래요</Link>
                  </Button>
                </div>
              )}
            </div>

            <MapPointSheet
              open={!!selectedMapPoint}
              onOpenChange={(open) => {
                if (!open) setSelectedMapPoint(null);
              }}
              selection={selectedMapPoint}
              boardingDetail={selectedBoardingDetail}
              boardingLoading={selectedBoardingLoading}
            />

            {selectedTripPoints.length > 0 ? (
              <div className="space-y-2">
                {selectedTripPoints.map((bp, idx) => (
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
            ) : hasBoardingPoints ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                셔틀을 선택하면 탑승 포인트가 표시됩니다
              </p>
            ) : null}
          </div>

          {/* Trips */}
          <div className="lg:col-span-2 space-y-4">
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
                  const isFull = trip.availability.remaining <= 0;
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
        </div>
      </div>
    </div>
  );
}
