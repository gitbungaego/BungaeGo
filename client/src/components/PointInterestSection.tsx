import { useEffect, useMemo, useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface CandidateRow {
  id: number;
  name: string;
  region: string;
  count: number;
  myInterested: boolean;
}

/**
 * "+1 여기서 출발 원해요" — 아직 셔틀이 없는 랠리 포인트 후보에 클릭 한
 * 번으로 수요 신호를 남기는 접힌 섹션. 지도에는 올리지 않고 리스트로만
 * 보여준다 (Rally 스타일 대청소 유지).
 */
export function PointInterestSection({ eventId }: { eventId: number }) {
  const { data: candidates } = trpc.pointInterests.byEvent.useQuery({ eventId });
  const [open, setOpen] = useState(false);

  const byRegion = useMemo(() => {
    const groups = new Map<string, CandidateRow[]>();
    (candidates ?? []).forEach((c) => {
      const list = groups.get(c.region) ?? [];
      list.push(c);
      groups.set(c.region, list);
    });
    // 지역별로 관심 많은 순
    for (const list of Array.from(groups.values())) list.sort((a, b) => b.count - a.count);
    return Array.from(groups.entries());
  }, [candidates]);

  if (!candidates || candidates.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-5">
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-2xl border border-dashed border-border px-4 py-3 text-left hover:border-primary/40 transition-colors">
        <div>
          <p className="text-sm font-semibold">원하는 출발지가 없나요?</p>
          <p className="text-xs text-muted-foreground mt-0.5">+1을 눌러 알려주시면 수요가 모이는 곳부터 셔틀을 준비할게요</p>
        </div>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform flex-shrink-0", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-2xl border border-border divide-y divide-border/60 overflow-hidden">
          {byRegion.map(([region, rows]) => (
            <div key={region}>
              <p className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">{region}</p>
              {rows.map((c) => (
                <InterestRow key={c.id} eventId={eventId} candidate={c} />
              ))}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function InterestRow({ eventId, candidate }: { eventId: number; candidate: CandidateRow }) {
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const [optimistic, setOptimistic] = useState({ interested: candidate.myInterested, count: candidate.count });

  useEffect(() => {
    setOptimistic({ interested: candidate.myInterested, count: candidate.count });
  }, [candidate.myInterested, candidate.count]);

  const toggle = trpc.pointInterests.toggle.useMutation({
    onSuccess: (data) => {
      setOptimistic(data);
      utils.pointInterests.byEvent.invalidate({ eventId });
    },
    onError: (err) => {
      setOptimistic({ interested: candidate.myInterested, count: candidate.count });
      toast.error(err.message || "잠시 후 다시 시도해주세요.");
    },
  });

  const handleClick = () => {
    if (!isAuthenticated) {
      window.location.href = getLoginUrl(window.location.pathname);
      return;
    }
    setOptimistic((prev) => ({
      interested: !prev.interested,
      count: Math.max(0, prev.count + (prev.interested ? -1 : 1)),
    }));
    toggle.mutate({ eventId, rallyPointCandidateId: candidate.id });
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <p className="min-w-0 flex-1 truncate text-sm">{candidate.name}</p>
      {optimistic.count > 0 && (
        <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">🙋 {optimistic.count}명</span>
      )}
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={optimistic.interested}
        className={cn(
          "flex-shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
          optimistic.interested
            ? "bg-primary text-black border-primary"
            : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
        )}
      >
        {optimistic.interested ? "+1 완료" : "+1"}
      </button>
    </div>
  );
}
