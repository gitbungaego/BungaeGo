import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FRAME_FIXED } from "@/components/AppShell";
import { DEMAND_REGIONS, DEMAND_STATIONS, formatShortDate } from "@/lib/constants";
import { Bus, Circle, CircleDot } from "lucide-react";

// 희망 탑승지 선택 (카카오T 수요조사 스타일) — 셔틀 만들기 2단계.
// 서울/수도권: 역 라디오 + 직접 입력. 그 외 지역: 지역 라디오 + OO동 입력 + 직접 입력.
export default function DemandPickPage({ eventId }: { eventId: number }) {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: event, isLoading: eventLoading } = trpc.events.byId.useQuery({ id: eventId });
  const { data: status } = trpc.shuttleDemands.status.useQuery({ eventId });

  const [tab, setTab] = useState<"capital" | "other">("capital");
  const [selected, setSelected] = useState(""); // 선택한 역/지역
  const [customStop, setCustomStop] = useState(""); // 직접 입력 거점
  const [neighborhood, setNeighborhood] = useState(""); // 그 외 지역 OO동

  // 이미 신청했으면 기존 선택 프리필 (변경 = 재제출 upsert).
  useEffect(() => {
    if (!status?.mine) return;
    setTab(status.mine.area);
    const label = status.mine.stopLabel;
    const known =
      status.mine.area === "capital"
        ? DEMAND_STATIONS.some((g) => g.stations.includes(label))
        : DEMAND_REGIONS.includes(label);
    if (known) setSelected(label);
    else setCustomStop(label);
    setNeighborhood(status.mine.neighborhood ?? "");
  }, [status?.mine]);

  const upsert = trpc.shuttleDemands.upsert.useMutation({
    onSuccess: async (r) => {
      await utils.shuttleDemands.status.invalidate({ eventId });
      toast.success(`수요 신청 완료! 현재 ${r.count}명이 기다리고 있어요.`);
      navigate("/demand");
    },
    onError: (e) => toast.error(e.message),
  });

  if (loading || eventLoading) {
    return (
      <div className="container py-6 space-y-3">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (!event) {
    return <div className="container py-16 text-center text-muted-foreground">이벤트를 찾을 수 없어요.</div>;
  }
  if (!isAuthenticated) {
    return (
      <div className="container max-w-md py-16 text-center space-y-4">
        <p className="text-muted-foreground">수요 신청은 로그인 후 이용할 수 있어요.</p>
        <Button asChild className="bg-[#FEE500] hover:bg-[#FDD800] text-black border-0">
          <a href={getLoginUrl(`/demand/${eventId}`)}>카카오로 3초 로그인</a>
        </Button>
      </div>
    );
  }

  const stopLabel = customStop.trim() || selected;
  const canSubmit = !!stopLabel && !upsert.isPending;

  const selectStation = (name: string) => {
    setSelected(name);
    setCustomStop("");
  };

  return (
    <div className="pb-32">
      <div className="container space-y-4 py-4">
        {/* 헤더 */}
        <div>
          <h1 className="text-lg font-bold leading-snug">
            수요가 많으면 오픈!
            <br />
            같이 모여서 셔틀 타요 🚌
          </h1>
          <p className="text-xs text-muted-foreground mt-1">셔틀이 오픈되면 알려드려요!</p>
        </div>

        {/* 이벤트 카드 */}
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5">
          <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-muted">
            {event.imageUrl ? (
              <img src={event.imageUrl} alt={event.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Bus className="h-5 w-5 text-muted-foreground/40" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{event.title}</p>
            <p className="truncate text-xs text-muted-foreground">{event.venue}</p>
            <p className="text-xs text-muted-foreground">
              {formatShortDate(event.eventDate)} <span className="text-blue-500 font-medium">수요조사</span>
            </p>
          </div>
        </div>

        {/* 안내 */}
        <div>
          <h2 className="font-bold">희망 탑승지를 알려주세요.</h2>
          <p className="text-xs text-muted-foreground mt-0.5">의견은 참고용으로 활용돼요.</p>
        </div>

        {/* 탭: 서울/수도권 | 그 외 지역 */}
        <div className="grid grid-cols-2 rounded-lg border border-border overflow-hidden text-sm font-medium">
          {(
            [
              { key: "capital", label: "서울/수도권" },
              { key: "other", label: "그 외 지역" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setSelected("");
                setCustomStop("");
              }}
              className={`py-2.5 transition-colors ${
                tab === t.key ? "bg-foreground text-background font-bold" : "bg-card text-muted-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 서울/수도권 — 역 라디오 (서울/경기/인천 그룹) */}
        {tab === "capital" && (
          <div className="space-y-4">
            {DEMAND_STATIONS.map((g) => (
              <div key={g.group}>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">{g.group}</p>
                <div className="space-y-0.5">
                  {g.stations.map((s) => (
                    <RadioRow key={s} label={s} selected={selected === s && !customStop.trim()} onClick={() => selectStation(s)} />
                  ))}
                </div>
              </div>
            ))}
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">원하는 역이 없다면 지하철 역명을 직접 입력해 주세요.</p>
              <Input value={customStop} onChange={(e) => setCustomStop(e.target.value)} maxLength={100} placeholder="ex) 잠실역" />
            </div>
          </div>
        )}

        {/* 그 외 지역 — 지역 라디오 + OO동 입력 */}
        {tab === "other" && (
          <div className="space-y-4">
            <div className="space-y-0.5">
              {DEMAND_REGIONS.map((r) => (
                <RadioRow key={r} label={r} selected={selected === r && !customStop.trim()} onClick={() => selectStation(r)} />
              ))}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                출발하는 동네(OO동)를 알려주시면 탑승지 선정에 큰 도움이 돼요. (선택)
              </p>
              <Input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} maxLength={100} placeholder="ex) 둔산동, 성산동" />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">원하는 지역이 없다면 주요 거점(역, 터미널, 시청 등)을 직접 입력해 주세요.</p>
              <Input value={customStop} onChange={(e) => setCustomStop(e.target.value)} maxLength={100} placeholder="ex) 천안역, 전주터미널, 청주시청" />
            </div>
          </div>
        )}
      </div>

      {/* 하단 고정: 안내 배너 + 신청 버튼 */}
      <div className={`${FRAME_FIXED} bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur`}>
        <div className="bg-blue-50 py-1.5 text-center text-xs font-medium text-blue-600">
          🔥 {status && status.count > 0 ? `현재 ${status.count}명 신청 — ` : ""}조금만 더 모이면 오픈될 수 있어요!
        </div>
        <div className="px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button
            size="lg"
            className="w-full text-base font-semibold"
            disabled={!canSubmit}
            onClick={() =>
              upsert.mutate({
                eventId,
                area: tab,
                stopLabel,
                neighborhood: tab === "other" ? neighborhood.trim() || undefined : undefined,
              })
            }
          >
            {upsert.isPending ? "신청 중…" : status?.mine ? "수요 신청 변경하기" : "수요 신청하기"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RadioRow({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
        selected ? "bg-primary/5 font-bold" : "hover:bg-muted"
      }`}
    >
      {selected ? (
        <CircleDot className="h-4 w-4 shrink-0 text-primary" />
      ) : (
        <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
      )}
      {label}
    </button>
  );
}
