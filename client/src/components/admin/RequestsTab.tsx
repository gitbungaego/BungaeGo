import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ARRIVAL_PREF_OPTIONS, CATEGORY_LABELS, formatDateTime } from "@/lib/constants";

// 관리자 '신청' 탭 — 이벤트 만들기 신청서 목록 + 셔틀 수요(희망 탑승지) 집계.
export function RequestsTab() {
  return (
    <div className="space-y-8">
      <EventRequestsSection />
      <DemandSummarySection />
    </div>
  );
}

const ARRIVAL_LABEL = Object.fromEntries(ARRIVAL_PREF_OPTIONS.map((o) => [o.key, o.label]));

function EventRequestsSection() {
  const utils = trpc.useUtils();
  const { data: requests, isLoading } = trpc.eventRequests.adminList.useQuery();
  const setStatus = trpc.eventRequests.setStatus.useMutation({
    onSuccess: () => {
      utils.eventRequests.adminList.invalidate();
      toast.success("처리 상태를 변경했어요.");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <section className="rounded-xl border border-border bg-white p-4">
      <h3 className="font-semibold mb-3">이벤트 만들기 신청</h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : !requests || requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">접수된 신청이 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <div key={r.id} className={`rounded-lg border p-3 text-sm space-y-1 ${r.status === "done" ? "border-border/50 opacity-60" : "border-border"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{r.title}</span>
                <Badge variant="outline">{CATEGORY_LABELS[r.category] ?? r.category}</Badge>
                {r.status === "done" ? (
                  <Badge className="bg-emerald-100 text-emerald-700 border-0">처리완료</Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-700 border-0">대기</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {r.startDate}
                {r.endDate ? ` ~ ${r.endDate}` : ""} · {r.origin} → {r.destination}
              </p>
              <p className="text-xs">
                도착 희망: {ARRIVAL_LABEL[r.arrivalPreference] ?? r.arrivalPreference}
                {r.arrivalNote ? ` — ${r.arrivalNote}` : ""}
              </p>
              {r.inquiry && <p className="text-xs text-muted-foreground">문의: {r.inquiry}</p>}
              <p className="text-xs">
                연락처: <span className="font-medium">{r.phone}</span> · {r.email}
              </p>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-muted-foreground">{formatDateTime(r.createdAt)} 접수</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: r.id, status: r.status === "done" ? "pending" : "done" })}
                >
                  {r.status === "done" ? "대기로 되돌리기" : "처리완료로 표시"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DemandSummarySection() {
  const { data: summary, isLoading } = trpc.shuttleDemands.adminSummary.useQuery();
  return (
    <section className="rounded-xl border border-border bg-white p-4">
      <h3 className="font-semibold mb-3">셔틀 수요 집계 (희망 탑승지)</h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : !summary || summary.length === 0 ? (
        <p className="text-sm text-muted-foreground">수요 신청이 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {summary.map((s) => (
            <div key={s.eventId} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium truncate">{s.eventTitle}</span>
                <span className="shrink-0 font-bold text-primary">🙋 {s.count}명</span>
              </div>
              {s.topStops.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">인기 탑승지: {s.topStops.join(" · ")}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
