import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CATEGORY_LABELS,
  formatDate,
  formatPrice,
  formatTime,
} from "@/lib/constants";
import { Bus, Calendar, MapPin } from "lucide-react";
import { Link, useLocation } from "wouter";
import { MapView, createArrivalMarker, createBoardingPointMarker } from "@/components/Map";
import { FRAME_FIXED } from "@/components/AppShell";
import { HeartButton } from "@/components/HeartButton";
import { PointInterestSection } from "@/components/PointInterestSection";
import { KAKAO_CHANNEL_CHAT_URL } from "@/const";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Props {
  id: number;
}

function tripStatusChip(status: string, remaining: number): { label: string; className: string } {
  if (status === "confirmed") return { label: "확정", className: "bg-emerald-50 text-emerald-600 border-emerald-200" };
  if (status === "cancelled") return { label: "취소됨", className: "bg-red-50 text-red-500 border-red-200" };
  if (remaining <= 0) return { label: "마감", className: "bg-gray-100 text-gray-500 border-gray-200" };
  return { label: "모집중", className: "bg-amber-50 text-amber-600 border-amber-200" };
}

export default function EventDetailPage({ id }: Props) {
  const [, navigate] = useLocation();
  const { data: event, isLoading: eventLoading } = trpc.events.byId.useQuery({ id });
  const { data: trips, isLoading: tripsLoading } = trpc.trips.byEventId.useQuery({ eventId: id });
  const { data: allBoardingPoints } = trpc.boardingPoints.byEventId.useQuery({ eventId: id });

  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [highlightedStopId, setHighlightedStopId] = useState<number | null>(null);
  const [map, setMap] = useState<any>(null);
  const markersRef = useRef<any[]>([]);
  const clustererRef = useRef<any>(null);
  const stopListRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const selectedTrip = trips?.find((t) => t.id === selectedTripId) ?? trips?.[0];

  // Boarding points grouped by trip, in trip order, so the stop list can render
  // one minimal section per shuttle.
  const stopsByTrip = useMemo(() => {
    const byTrip = new Map<number, typeof allBoardingPoints>();
    (allBoardingPoints ?? []).forEach((bp) => {
      const list = byTrip.get(bp.tripId) ?? [];
      list.push(bp);
      byTrip.set(bp.tripId, list);
    });
    return byTrip;
  }, [allBoardingPoints]);

  const lowestPrice = useMemo(() => {
    const prices = (trips ?? []).filter((t) => t.status !== "cancelled").map((t) => t.price);
    return prices.length ? Math.min(...prices) : null;
  }, [trips]);

  const handleMapReady = useCallback((m: any) => setMap(m), []);

  const focusStop = useCallback((boardingPointId: number, tripId: number) => {
    setSelectedTripId(tripId);
    setHighlightedStopId(boardingPointId);
    // Let the selected-trip re-render settle, then bring the row into view.
    requestAnimationFrame(() => {
      rowRefs.current[boardingPointId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  useEffect(() => {
    if (highlightedStopId === null) return;
    const timer = setTimeout(() => setHighlightedStopId(null), 1800);
    return () => clearTimeout(timer);
  }, [highlightedStopId]);

  // The ONLY two marker kinds on the map: yellow boarding-stop teardrops
  // (selected trip large + numbered, others small + desaturated) and one black
  // arrival pin for the venue. No demand circles, no candidate dots.
  useEffect(() => {
    if (!map || !window.kakao || !event) return;

    clustererRef.current?.clear();
    clustererRef.current = null;
    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];
    const clusterable: any[] = [];

    const bounds = new window.kakao.maps.LatLngBounds();
    let hasBounds = false;

    // 공연장(도착지)이 있으면 지도 "정중앙"이 공연장이 되도록 한다: 각 탑승장을
    // bounds에 넣을 때 공연장 기준 대칭점도 함께 넣으면 bounds의 중심이 정확히
    // 공연장 좌표가 되면서도 모든 탑승장이 화면 안에 들어온다.
    const venue = event.lat && event.lng ? { lat: Number(event.lat), lng: Number(event.lng) } : null;

    if (venue) {
      markersRef.current.push(createArrivalMarker(map, venue, `${event.venue} (도착지)`));
      bounds.extend(new window.kakao.maps.LatLng(venue.lat, venue.lng));
      hasBounds = true;
    }

    (allBoardingPoints ?? []).forEach((bp) => {
      if (!bp.lat || !bp.lng) return;
      const isSelected = bp.tripId === selectedTrip?.id;
      const order = isSelected
        ? (stopsByTrip.get(bp.tripId) ?? []).findIndex((p) => p.id === bp.id) + 1
        : undefined;

      const marker = createBoardingPointMarker(
        map,
        { lat: Number(bp.lat), lng: Number(bp.lng) },
        {
          label: order ? String(order) : undefined,
          muted: !isSelected,
          title: bp.name,
          onClick: () => focusStop(bp.id, bp.tripId),
        }
      );
      markersRef.current.push(marker);
      clusterable.push(marker);
      bounds.extend(new window.kakao.maps.LatLng(Number(bp.lat), Number(bp.lng)));
      if (venue) {
        // 공연장 기준 대칭점도 포함 → bounds 중심 = 공연장 (정중앙 유지).
        bounds.extend(
          new window.kakao.maps.LatLng(2 * venue.lat - Number(bp.lat), 2 * venue.lng - Number(bp.lng))
        );
      }
      hasBounds = true;
    });

    if (hasBounds) {
      // relayout: 컨테이너 크기 캐시가 어긋나면 중심이 시각적으로 밀려 보이는 것 보정.
      map.relayout();
      map.setBounds(bounds);
    }

    if (clusterable.length > 0 && window.kakao.maps.MarkerClusterer) {
      clustererRef.current = new window.kakao.maps.MarkerClusterer({
        map,
        markers: clusterable,
        minLevel: 6,
        minClusterSize: 3,
        averageCenter: true,
      });
    }
  }, [map, allBoardingPoints, selectedTrip?.id, stopsByTrip, event, focusStop]);

  useEffect(() => {
    return () => {
      clustererRef.current?.clear();
      markersRef.current.forEach((marker) => marker.setMap(null));
    };
  }, []);

  if (eventLoading) {
    return (
      <div className="py-8">
        <div className="container max-w-2xl">
          <Skeleton className="h-64 w-full rounded-2xl mb-6" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!event) {
    return <div className="py-20 text-center text-muted-foreground">이벤트를 찾을 수 없습니다.</div>;
  }

  const hasTrips = (trips?.length ?? 0) > 0;

  return (
    <div className="pb-24">
      <div className="container max-w-2xl pt-4">
        {/* back 내비게이션은 앱 셸의 상단 헤더가 담당 */}
        {/* ── Block 1: Hero ── */}
        <div className="relative rounded-2xl overflow-hidden border border-border mb-5">
          <div className="relative h-52 sm:h-64">
            {event.imageUrl ? (
              <img src={event.imageUrl} alt={event.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-primary via-amber-400 to-orange-400" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20" />

            <div className="absolute top-3 right-3">
              <HeartButton eventId={event.id} liked={event.myLiked} count={event.likeCount} returnTo={`/events/${event.id}`} />
            </div>

            <div className="absolute bottom-4 left-4 right-4">
              <Badge variant="outline" className="mb-2 bg-white/90 border-0 text-xs font-medium">
                {CATEGORY_LABELS[event.category] ?? event.category}
              </Badge>
              <h1 className="text-white text-xl sm:text-2xl font-bold leading-tight drop-shadow-sm">{event.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-white/90 text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  {formatDate(event.eventDate)} {formatTime(event.eventDate)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" />
                  {event.venue}
                </span>
              </div>
            </div>
          </div>
          {/* Tags (display only) */}
          {event.tags && (
            <div className="flex flex-wrap gap-1.5 px-4 py-3 bg-card">
              {event.tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
                .map((tag) => (
                  <span key={tag} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                    {tag}
                  </span>
                ))}
            </div>
          )}
        </div>

        {/* ── Block 2: Map (stop pins + arrival pin only) ── */}
        <div className="rounded-2xl overflow-hidden border border-border h-[38vh] min-h-[260px] lg:h-[380px] mb-5">
          <MapView
            className="h-full"
            onMapReady={handleMapReady}
            initialCenter={event.lat && event.lng ? { lat: Number(event.lat), lng: Number(event.lng) } : { lat: 37.5155, lng: 127.0726 }}
            initialZoom={12}
          />
        </div>

        {/* ── Block 3: Stop-centric list ── */}
        <div ref={stopListRef} className="scroll-mt-4">
          <h2 className="text-lg font-semibold mb-3">탑승 정류장</h2>

          {tripsLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          ) : hasTrips ? (
            <div className="space-y-5">
              {(trips ?? []).map((trip) => {
                const stops = stopsByTrip.get(trip.id) ?? [];
                const chip = tripStatusChip(trip.status, trip.availability.remaining);
                const pct = Math.min(100, Math.round((trip.currentCount / trip.minCount) * 100));
                const isFull = trip.availability.remaining <= 0 || trip.status === "cancelled";
                const isSelected = selectedTrip?.id === trip.id;

                return (
                  <div
                    key={trip.id}
                    className={`rounded-2xl border overflow-hidden transition-colors ${isSelected ? "border-primary/60" : "border-border"}`}
                  >
                    {/* One-line section header per shuttle */}
                    <button
                      type="button"
                      onClick={() => setSelectedTripId(trip.id)}
                      className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left ${isSelected ? "bg-primary/5" : "bg-card"}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm">{trip.mode === "bus" ? "🚌" : "🚐"}</span>
                        <span className="text-sm font-semibold whitespace-nowrap">{formatTime(trip.departureAt)} 출발</span>
                        <Badge variant="outline" className={`text-[11px] border ${chip.className}`}>{chip.label}</Badge>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs text-muted-foreground tabular-nums">{trip.currentCount}/{trip.minCount}명</span>
                        <span className="text-sm font-bold text-primary whitespace-nowrap">{formatPrice(trip.price)}</span>
                      </div>
                    </button>
                    <div className="px-4 pb-1">
                      <Progress value={pct} className="h-1.5" />
                    </div>

                    {/* Stop rows */}
                    <div className="divide-y divide-border/60">
                      {stops.length > 0 ? (
                        stops.map((bp, idx) => {
                          const isHighlighted = highlightedStopId === bp.id;
                          return (
                            <div
                              key={bp.id}
                              ref={(el) => { rowRefs.current[bp.id] = el; }}
                              className={`flex items-center gap-3 px-4 py-3 transition-colors scroll-mt-24 ${isHighlighted ? "bg-primary/10" : ""}`}
                            >
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-black text-xs font-bold flex-shrink-0">
                                {idx + 1}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">{bp.name}</p>
                                {bp.pickupTime && (
                                  <p className="text-xs text-muted-foreground">픽업 {formatTime(bp.pickupTime)}</p>
                                )}
                              </div>
                              <Button
                                size="sm"
                                className="flex-shrink-0"
                                disabled={isFull}
                                onClick={() => navigate(`/trips/${trip.id}/book`)}
                              >
                                {isFull ? "마감" : "예약"}
                              </Button>
                            </div>
                          );
                        })
                      ) : (
                        <div className="flex items-center justify-between gap-3 px-4 py-3">
                          <p className="text-sm text-muted-foreground">정류장 정보 준비 중</p>
                          <Button size="sm" disabled={isFull} onClick={() => navigate(`/trips/${trip.id}/book`)}>
                            {isFull ? "마감" : "예약"}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-14 text-muted-foreground border border-dashed border-border rounded-2xl">
              <Bus className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">아직 등록된 셔틀이 없어요</p>
              <Button variant="outline" size="sm" className="mt-3" asChild>
                <Link href="/create">셔틀 만들기</Link>
              </Button>
            </div>
          )}

          <PointInterestSection eventId={event.id} />

          <p className="mt-6 text-center text-xs text-muted-foreground">
            궁금한 점이 있나요?{" "}
            <a
              href={KAKAO_CHANNEL_CHAT_URL}
              target="_blank"
              rel="noopener"
              className="font-medium text-black underline decoration-[#FEE500] decoration-2 underline-offset-2 hover:bg-[#FEE500]/40 rounded px-0.5 transition-colors"
            >
              카카오톡으로 문의하기
            </a>
          </p>
        </div>
      </div>

      {/* ── Block 4: Fixed bottom CTA — 앱 셸 프레임 폭에 맞춰 항상 표시 ── */}
      {hasTrips && lowestPrice !== null && (
        <div className={`${FRAME_FIXED} bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]`}>
          <Button
            size="lg"
            className="w-full text-base font-semibold"
            onClick={() => stopListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            예약하기 · {formatPrice(lowestPrice)}~
          </Button>
        </div>
      )}
    </div>
  );
}
