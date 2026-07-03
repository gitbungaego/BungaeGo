import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapView } from "@/components/Map";
import { formatDateTime, formatPrice } from "@/lib/constants";
import { ChevronDown, Route, Snowflake } from "lucide-react";

type PipelineParamsInput = {
  bucketSizeMinutes: number;
  epsMeters: number;
  minPts: number;
  maxSnapDistanceMeters: number;
  maxCapacitySeats: number;
  minCapacitySeats: number;
  avgSpeedKmh: number;
  stopDwellMinutes: number;
  mergeMaxDetourMinutes: number;
  mergeMaxDetourKm: number;
};

const DEFAULT_PARAMS: PipelineParamsInput = {
  bucketSizeMinutes: 30,
  epsMeters: 800,
  minPts: 10,
  maxSnapDistanceMeters: 300,
  maxCapacitySeats: 45,
  minCapacitySeats: 15,
  avgSpeedKmh: 30,
  stopDwellMinutes: 3,
  mergeMaxDetourMinutes: 15,
  mergeMaxDetourKm: 10,
};

const CLUSTER_COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#d97706", "#9333ea",
  "#0891b2", "#db2777", "#65a30d", "#4f46e5", "#ea580c",
];

type PreviewOutput = {
  clusters: Array<{
    clusterId: number;
    groupKey: string;
    memberRequestIds: number[];
    status: "viable" | "merged" | "failed";
    assignedStopId: number | null;
    assignedLat: number;
    assignedLng: number;
    isAdHocStop: boolean;
  }>;
  routes: Array<{
    groupKey: string;
    routeIndex: number;
    stops: Array<{
      clusterId: number;
      lat: number;
      lng: number;
      seats: number;
      order: number;
      pickupTime: string | Date;
    }>;
    totalSeats: number;
    departureAt: string | Date;
  }>;
  failedRequestIds: number[];
};

export function MatchingTab() {
  const { data: events, isLoading: eventsLoading } = trpc.events.adminList.useQuery();
  const autoMatchEvents = events?.filter((e) => e.autoMatchEnabled) ?? [];
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [params, setParams] = useState<PipelineParamsInput>(DEFAULT_PARAMS);
  const [preview, setPreview] = useState<PreviewOutput | null>(null);

  useEffect(() => {
    if (!selectedEventId && autoMatchEvents.length > 0) {
      setSelectedEventId(autoMatchEvents[0].id);
    }
  }, [autoMatchEvents, selectedEventId]);

  const utils = trpc.useUtils();
  const selectedEvent = events?.find((e) => e.id === selectedEventId);

  const { data: pendingRequests } = trpc.admin.matching.pendingRequests.useQuery(
    { eventId: selectedEventId ?? -1 },
    { enabled: !!selectedEventId }
  );

  const previewMutation = trpc.admin.matching.preview.useMutation({
    onSuccess: (data) => {
      setPreview(data as PreviewOutput);
      toast.success(`군집 ${data.clusters.length}개, 노선 ${data.routes.length}개 계산되었습니다.`);
    },
    onError: (err) => toast.error(err.message),
  });

  const commitMutation = trpc.admin.matching.commit.useMutation({
    onSuccess: (data) => {
      setPreview(data as PreviewOutput);
      toast.success(`셔틀 ${data.createdTripCount}개 생성, ${data.matchedRequestCount}건 매칭 완료.`);
      utils.events.adminList.invalidate();
      utils.trips.adminList.invalidate();
      utils.reservations.adminList.invalidate();
      utils.admin.matching.pendingRequests.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const freezeMutation = trpc.admin.matching.freeze.useMutation({
    onSuccess: (data) => {
      toast.success(`동결 완료. 미매칭 ${data.refundedCount}건 환불되었습니다.`);
      utils.events.adminList.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (eventsLoading) return <Skeleton className="h-64 rounded-xl" />;

  if (autoMatchEvents.length === 0) {
    return (
      <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
        자동 매칭이 활성화된 이벤트가 없습니다. 이벤트 목록에서 자동 매칭을 켜주세요.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={selectedEventId ? String(selectedEventId) : undefined}
          onValueChange={(v) => {
            setSelectedEventId(Number(v));
            setPreview(null);
          }}
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder="이벤트 선택" />
          </SelectTrigger>
          <SelectContent>
            {autoMatchEvents.map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>
                {e.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedEvent?.matchingFrozenAt && (
          <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200 gap-1">
            <Snowflake className="h-3 w-3" /> 동결됨
          </Badge>
        )}
      </div>

      {selectedEventId && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="대기 요청" value={pendingRequests?.length ?? 0} />
            <StatCard label="군집 수" value={preview?.clusters.length ?? "—"} />
            <StatCard label="노선 수" value={preview?.routes.length ?? "—"} />
          </div>

          <AdvancedSettings params={params} onChange={setParams} />

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={previewMutation.isPending || !!selectedEvent?.matchingFrozenAt}
              onClick={() =>
                previewMutation.mutate({ eventId: selectedEventId, params })
              }
            >
              <Route className="h-4 w-4" />
              {previewMutation.isPending ? "계산 중..." : "재계산"}
            </Button>

            <Button
              disabled={!preview || commitMutation.isPending || !!selectedEvent?.matchingFrozenAt}
              onClick={() => commitMutation.mutate({ eventId: selectedEventId, params })}
            >
              {commitMutation.isPending ? "확정 중..." : "확정 (배차 커밋)"}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={!!selectedEvent?.matchingFrozenAt || freezeMutation.isPending}
                >
                  동결 & 환불
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>배차를 동결하시겠습니까?</AlertDialogTitle>
                  <AlertDialogDescription>
                    되돌릴 수 없습니다. 아직 매칭되지 않은 신청은 모두 실패 처리되어 포인트가 환불되고,
                    이후 참가 신청 및 재계산이 차단됩니다.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction onClick={() => freezeMutation.mutate({ eventId: selectedEventId })}>
                    동결 확정
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {preview && (
            <PreviewResult preview={preview} venue={selectedEvent ? { lat: Number(selectedEvent.lat), lng: Number(selectedEvent.lng) } : undefined} />
          )}
        </>
      )}

      <StopCandidatesSection />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function AdvancedSettings({
  params,
  onChange,
}: {
  params: PipelineParamsInput;
  onChange: (p: PipelineParamsInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const fields: Array<{ key: keyof PipelineParamsInput; label: string }> = [
    { key: "bucketSizeMinutes", label: "시간 버킷(분)" },
    { key: "epsMeters", label: "군집 반경(m)" },
    { key: "minPts", label: "최소 인원" },
    { key: "maxSnapDistanceMeters", label: "정류장 스냅 거리(m)" },
    { key: "maxCapacitySeats", label: "최대 좌석" },
    { key: "minCapacitySeats", label: "최소 확정 좌석" },
    { key: "avgSpeedKmh", label: "평균 속도(km/h)" },
    { key: "stopDwellMinutes", label: "정차 시간(분)" },
    { key: "mergeMaxDetourMinutes", label: "병합 최대 우회(분)" },
    { key: "mergeMaxDetourKm", label: "병합 최대 우회(km)" },
  ];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-xs">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          고급 설정
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-2 rounded-xl border border-border p-4">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs text-muted-foreground">{f.label}</Label>
              <Input
                type="number"
                value={params[f.key]}
                onChange={(e) =>
                  onChange({ ...params, [f.key]: Number(e.target.value) })
                }
                className="h-8 text-sm"
              />
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function PreviewResult({
  preview,
  venue,
}: {
  preview: PreviewOutput;
  venue?: { lat: number; lng: number };
}) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<Array<google.maps.marker.AdvancedMarkerElement | google.maps.Polyline>>([]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google) return;

    overlaysRef.current.forEach((o) => {
      if ("setMap" in o) o.setMap(null);
    });
    overlaysRef.current = [];

    const clusterColorByRequestId = new Map<number, string>();
    preview.clusters.forEach((c, idx) => {
      const color = CLUSTER_COLORS[idx % CLUSTER_COLORS.length];
      c.memberRequestIds.forEach((id) => clusterColorByRequestId.set(id, color));

      const pin = document.createElement("div");
      pin.style.width = "12px";
      pin.style.height = "12px";
      pin.style.borderRadius = "50%";
      pin.style.background = c.status === "failed" ? "#9ca3af" : color;
      pin.style.border = "2px solid white";

      const marker = new window.google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: c.assignedLat, lng: c.assignedLng },
        content: pin,
        title: `${c.status} (${c.memberRequestIds.length}명)`,
      });
      overlaysRef.current.push(marker);
    });

    if (venue) {
      const venuePin = document.createElement("div");
      venuePin.style.width = "16px";
      venuePin.style.height = "16px";
      venuePin.style.background = "#111827";
      venuePin.style.borderRadius = "3px";
      const venueMarker = new window.google.maps.marker.AdvancedMarkerElement({
        map,
        position: venue,
        content: venuePin,
        title: "행사장",
      });
      overlaysRef.current.push(venueMarker);
    }

    preview.routes.forEach((route, idx) => {
      const path = [...route.stops]
        .sort((a, b) => a.order - b.order)
        .map((s) => ({ lat: s.lat, lng: s.lng }));
      if (venue) path.push(venue);

      const polyline = new window.google.maps.Polyline({
        path,
        map,
        strokeColor: CLUSTER_COLORS[idx % CLUSTER_COLORS.length],
        strokeOpacity: 0.7,
        strokeWeight: 3,
      });
      overlaysRef.current.push(polyline);
    });
  }, [preview, venue]);

  return (
    <div className="space-y-4">
      <MapView
        initialCenter={venue ?? { lat: 37.5665, lng: 126.978 }}
        initialZoom={11}
        onMapReady={(map) => {
          mapRef.current = map;
        }}
      />

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-muted/40 text-sm font-medium">
            군집 ({preview.clusters.length})
          </div>
          <div className="max-h-72 overflow-auto divide-y divide-border">
            {preview.clusters.map((c) => (
              <div key={c.clusterId} className="px-4 py-2 text-sm flex items-center justify-between">
                <span>
                  {c.memberRequestIds.length}명
                  {c.isAdHocStop && <span className="text-xs text-muted-foreground ml-1">(임시 정류장)</span>}
                </span>
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    c.status === "viable"
                      ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                      : c.status === "merged"
                      ? "bg-blue-50 text-blue-600 border-blue-200"
                      : "bg-red-50 text-red-500 border-red-200"
                  }`}
                >
                  {c.status === "viable" ? "확정" : c.status === "merged" ? "병합됨" : "실패"}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-muted/40 text-sm font-medium">
            노선 ({preview.routes.length})
          </div>
          <div className="max-h-72 overflow-auto divide-y divide-border">
            {preview.routes.map((r) => (
              <div key={r.routeIndex} className="px-4 py-2 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">노선 #{r.routeIndex + 1}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.totalSeats}석 · 출발 {formatDateTime(r.departureAt)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">정류장 {r.stops.length}개</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {preview.failedRequestIds.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          매칭 실패 {preview.failedRequestIds.length}건 (요청 ID: {preview.failedRequestIds.join(", ")})
        </div>
      )}
    </div>
  );
}

function StopCandidatesSection() {
  const utils = trpc.useUtils();
  const { data: stops, isLoading } = trpc.stopCandidates.list.useQuery();
  const [form, setForm] = useState({ name: "", address: "", lat: "", lng: "", capacity: "" });

  const createMutation = trpc.stopCandidates.create.useMutation({
    onSuccess: () => {
      toast.success("정류장 후보가 추가되었습니다.");
      setForm({ name: "", address: "", lat: "", lng: "", capacity: "" });
      utils.stopCandidates.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const setActiveMutation = trpc.stopCandidates.setActive.useMutation({
    onSuccess: () => utils.stopCandidates.list.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-2 border-b border-border bg-muted/40 text-sm font-medium">
        정류장 후보 관리
      </div>

      <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-2">
        <Input placeholder="이름" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-8 text-sm" />
        <Input placeholder="주소" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="h-8 text-sm" />
        <Input placeholder="위도" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} className="h-8 text-sm" />
        <Input placeholder="경도" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} className="h-8 text-sm" />
        <Button
          size="sm"
          className="h-8"
          disabled={!form.name || !form.lat || !form.lng || createMutation.isPending}
          onClick={() =>
            createMutation.mutate({
              name: form.name,
              address: form.address || undefined,
              lat: form.lat,
              lng: form.lng,
              capacity: form.capacity ? Number(form.capacity) : undefined,
            })
          }
        >
          추가
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 m-4 rounded-lg" />
      ) : (
        <div className="divide-y divide-border">
          {stops?.map((s) => (
            <div key={s.id} className="px-4 py-2 text-sm flex items-center justify-between">
              <div>
                <p className="font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">{s.address ?? `${s.lat}, ${s.lng}`}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setActiveMutation.mutate({ id: s.id, active: !s.active })}
              >
                {s.active ? "비활성화" : "활성화"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
