import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/useMobile";
import { formatDateTime, formatPrice, formatTime, TRIP_STATUS_COLORS, TRIP_STATUS_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Bus, Clock, MapPin, Users } from "lucide-react";
import { Link } from "wouter";

interface NearbyDemand {
  count: number;
  seats: number;
}

interface BoardingPointDetail {
  point: {
    id: number;
    name: string;
    address: string | null;
    pickupTime: Date | string | null;
  };
  nearbyDemand: NearbyDemand;
  trips: Array<{
    id: number;
    status: string;
    price: number;
    departureAt: Date | string;
    pickupTime: Date | string | null;
    currentCount: number;
    minCount: number;
    maxCount: number;
    availability: { remaining: number };
  }>;
}

export type MapPointSelection =
  | { type: "boarding"; boardingPointId: number }
  | {
      type: "candidate";
      id: number;
      eventId: number;
      name: string;
      region: string;
      lat: number;
      lng: number;
      busAccessible: boolean;
      notes: string | null;
      nearbyDemand: NearbyDemand;
      autoMatchEnabled: boolean;
    }
  | { type: "demand"; lat: number; lng: number; count: number; seats: number };

interface MapPointSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selection: MapPointSelection | null;
  boardingDetail?: BoardingPointDetail;
  boardingLoading?: boolean;
  className?: string;
}

function DemandLine({ demand }: { demand: NearbyDemand }) {
  if (demand.count <= 0) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
      <Users className="h-4 w-4" />
      <span>이 근처 {demand.seats}명이 출발을 원해요</span>
    </div>
  );
}

function BoardingPointBody({ detail, loading }: { detail?: BoardingPointDetail; loading?: boolean }) {
  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (!detail) {
    return <p className="text-sm text-muted-foreground">포인트 정보를 불러오지 못했습니다.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">{detail.point.name}</h3>
        {detail.point.address && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            {detail.point.address}
          </p>
        )}
        {detail.point.pickupTime && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-primary">
            <Clock className="h-3.5 w-3.5" />
            픽업 {formatTime(detail.point.pickupTime)}
          </p>
        )}
      </div>

      <DemandLine demand={detail.nearbyDemand} />

      <div className="space-y-2">
        <p className="text-sm font-medium">경유 셔틀</p>
        {detail.trips.length > 0 ? (
          detail.trips.map((trip) => {
            const progress = Math.min(100, Math.round((trip.currentCount / trip.maxCount) * 100));
            const disabled = trip.availability.remaining <= 0 || trip.status === "cancelled";
            return (
              <div key={trip.id} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={cn("text-xs border", TRIP_STATUS_COLORS[trip.status] ?? "")}>
                      {TRIP_STATUS_LABELS[trip.status] ?? trip.status}
                    </Badge>
                    <span className="text-sm font-semibold text-primary">{formatPrice(trip.price)}</span>
                  </div>
                  <Button size="sm" disabled={disabled} asChild={!disabled}>
                    {disabled ? <span>예약 불가</span> : <Link href={`/trips/${trip.id}/book`}>예약하기</Link>}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">출발 {formatDateTime(trip.departureAt)}</p>
                {trip.pickupTime && <p className="mt-1 text-xs text-muted-foreground">픽업 {formatTime(trip.pickupTime)}</p>}
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span>
                      {trip.currentCount}/{trip.maxCount}명
                    </span>
                    <span>잔여 {trip.availability.remaining}석</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                  <p className="text-xs text-muted-foreground">최소 {trip.minCount}명 필요</p>
                </div>
              </div>
            );
          })
        ) : (
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            아직 이 포인트를 경유하는 셔틀이 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}

function CandidateBody({ selection }: { selection: Extract<MapPointSelection, { type: "candidate" }> }) {
  const joinHref = `/events/${selection.eventId}/join?originLat=${encodeURIComponent(selection.lat)}&originLng=${encodeURIComponent(selection.lng)}&originAddress=${encodeURIComponent(`${selection.name}, ${selection.region}`)}`;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">{selection.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{selection.region}</p>
        <Badge variant="outline" className={cn("mt-2", selection.busAccessible ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
          {selection.busAccessible ? "정차 확인됨" : "정차 확인 중"}
        </Badge>
        {selection.notes && <p className="mt-2 text-sm text-muted-foreground">{selection.notes}</p>}
      </div>

      <DemandLine demand={selection.nearbyDemand} />

      <div className="rounded-xl border border-dashed border-border p-4 text-center">
        <Bus className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">아직 이 지점에서 출발하는 셔틀이 없습니다.</p>
        {selection.autoMatchEnabled && (
          <Button className="mt-3 w-full" asChild>
            <Link href={joinHref}>여기서 출발 신청하기</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function DemandBody({ selection }: { selection: Extract<MapPointSelection, { type: "demand" }> }) {
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">출발 수요</h3>
      <DemandLine demand={{ count: selection.count, seats: selection.seats }} />
      <p className="text-sm text-muted-foreground">
        이 원은 정확한 개인 위치가 아니라 익명화된 집계 영역입니다.
      </p>
    </div>
  );
}

function Content({ selection, boardingDetail, boardingLoading }: MapPointSheetProps) {
  if (!selection) return null;
  if (selection.type === "boarding") {
    return <BoardingPointBody detail={boardingDetail} loading={boardingLoading} />;
  }
  if (selection.type === "candidate") return <CandidateBody selection={selection} />;
  return <DemandBody selection={selection} />;
}

export function MapPointSheet(props: MapPointSheetProps) {
  const isMobile = useIsMobile();
  const title =
    props.selection?.type === "boarding"
      ? "탑승 포인트"
      : props.selection?.type === "candidate"
      ? "랠리 포인트 후보"
      : "근처 수요";

  if (isMobile) {
    return (
      <Drawer open={props.open} onOpenChange={props.onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>지도에서 선택한 지점의 정보입니다.</DrawerDescription>
          </DrawerHeader>
          <div className="max-h-[62vh] overflow-y-auto px-4 pb-6">
            <Content {...props} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  if (!props.open || !props.selection) return null;

  return (
    <aside className={cn("rounded-xl border border-border bg-background p-4 shadow-sm", props.className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">지도에서 선택한 지점</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => props.onOpenChange(false)}>
          닫기
        </Button>
      </div>
      <Content {...props} />
    </aside>
  );
}
