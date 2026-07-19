import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Lightbulb, Plus } from "lucide-react";
import { GENDER_MODE_LABELS } from "@/lib/bungaeting";
import { CATEGORY_CHIPS, formatDateTime } from "@/lib/constants";

// 회차 제안 목록 + 찜 (spec §3-5). "이 회차에 관심"이지 "이 사람과 함께"가 아님(§4):
// 특정인 지목/연결 요소 없음, 순수 행사·날짜 관심 표시.
export default function BungaetingProposals() {
  const { isAuthenticated, loading } = useAuth();
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);

  const { data: proposals, isLoading } = trpc.bungaeting.proposals.list.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });

  const toggle = trpc.bungaeting.proposals.toggleInterest.useMutation({
    onSuccess: () => utils.bungaeting.proposals.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  if (loading || (isAuthenticated && isLoading)) {
    return <div className="container py-16 text-center text-muted-foreground">불러오는 중…</div>;
  }
  if (!isAuthenticated) {
    return (
      <div className="container max-w-md py-16 text-center space-y-4">
        <p className="text-muted-foreground">로그인 후 이용할 수 있어요.</p>
        <Button asChild className="bg-[#FEE500] hover:bg-[#FDD800] text-black border-0">
          <a href={getLoginUrl("/bungaeting/proposals")}>카카오로 3초 로그인</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="container max-w-lg py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-1.5"><Lightbulb className="h-5 w-5" /> 회차 제안</h1>
          <p className="text-sm text-muted-foreground">원하는 행사·날짜를 제안하고, 관심 있는 제안에 찜하세요.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> 제안
        </Button>
      </div>

      {showForm && <ProposalForm onDone={() => setShowForm(false)} />}

      {!proposals || proposals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          아직 제안이 없어요. 첫 제안을 남겨보세요.
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => (
            <div key={p.id} className="rounded-xl border border-border bg-white p-4">
              <div className="font-semibold">{p.eventTitle}</div>
              {p.venue && <div className="text-xs text-muted-foreground">{p.venue}</div>}
              <div className="text-xs text-muted-foreground mt-1">{formatDateTime(p.proposedDate)} 희망</div>
              {p.notes && <p className="text-sm mt-1 text-foreground/80">{p.notes}</p>}

              {/* 성비 모드별 찜 집계 */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">찜 {p.interestTotal}</span>
                {Object.entries(p.interestByMode).map(([mode, n]) => (
                  <span key={mode} className="rounded-full border border-border px-1.5 py-0.5">
                    {GENDER_MODE_LABELS[mode] ?? mode} {n}
                  </span>
                ))}
              </div>

              <Button
                size="sm"
                variant={p.myInterested ? "default" : "outline"}
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ proposalId: p.id })}
                className={`mt-3 w-full ${p.myInterested ? "bg-[#FEE500] hover:bg-[#FDD800] text-black border-0" : ""}`}
              >
                {p.myInterested ? "찜 완료" : "이 회차 찜하기"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalForm({ onDone }: { onDone: () => void }) {
  const utils = trpc.useUtils();
  // 카테고리 먼저 선택 → 그 카테고리의 행사만 목록에 노출 (서버 필터 재사용).
  const [category, setCategory] = useState("all");
  const { data: events } = trpc.events.list.useQuery({
    category: category === "all" ? undefined : category,
    limit: 50,
  });
  const [eventId, setEventId] = useState<string>("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");

  const create = trpc.bungaeting.proposals.create.useMutation({
    onSuccess: () => {
      utils.bungaeting.proposals.list.invalidate();
      toast.success("제안을 등록했어요.");
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });

  const canSubmit = eventId && date && !create.isPending;

  return (
    <div className="rounded-xl border border-[#FEE500]/60 bg-[#FFFDF5] p-4 space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">카테고리</Label>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                setCategory(c.key);
                setEventId(""); // 카테고리 전환 시 선택 초기화
              }}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                category === c.key ? "bg-black text-white border-black" : "border-border text-muted-foreground bg-white"
              }`}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">행사</Label>
        <select
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="">{events && events.length === 0 ? "이 카테고리에 행사가 없어요" : "행사 선택"}</option>
          {events?.map((e) => (
            <option key={e.id} value={e.id}>{e.title}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">희망 날짜</Label>
        <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">메모 (선택)</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={300} placeholder="예: 주말 오후 출발 희망" />
      </div>
      <Button
        className="w-full bg-[#FEE500] hover:bg-[#FDD800] text-black border-0"
        disabled={!canSubmit}
        onClick={() =>
          create.mutate({ eventId: Number(eventId), proposedDate: new Date(date).getTime(), notes: notes.trim() || undefined })
        }
      >
        {create.isPending ? "등록 중…" : "제안 등록"}
      </Button>
    </div>
  );
}
