import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { GENDER_MODE_LABELS } from "@/lib/bungaeting";
import { formatDateTime, formatPrice } from "@/lib/constants";

// 관리자 번개팅 탭 — 기존 Admin.tsx 탭 구조에 통합되는 컴포넌트(새 페이지 아님).
// 회차 생성은 셔틀 만들기의 "번개팅 모드" 토글로 일원화됨 — 여기선 모집현황·제안전환·
// 신고처리·알림발송만. FEATURE OFF면 서버가 NOT_FOUND.
export function BungaetingTab() {
  return (
    <div className="space-y-8">
      <RecruitmentSection />
      <ProposalsSection />
      <ReportsSection />
      <NotificationSection />
    </div>
  );
}

// ── 성비 모집 현황 ───────────────────────────────────────────────────────────────
function RecruitmentSection() {
  const { data: trips, isLoading } = trpc.bungaeting.admin.listTrips.useQuery();
  if (isLoading) return <SectionShell title="모집 현황">불러오는 중…</SectionShell>;
  return (
    <SectionShell title="성비 모집 현황">
      {!trips || trips.length === 0 ? (
        <p className="text-sm text-muted-foreground">번개팅 회차가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {trips.map((t) => (
            <div key={t.id} className="rounded-lg border border-border p-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-medium">#{t.id}</span>
              <Badge variant="outline">{GENDER_MODE_LABELS[t.genderMode]}</Badge>
              <span>{t.status}</span>
              <span className="text-muted-foreground">{formatDateTime(t.departureAt)}</span>
              <span>{formatPrice(t.price)}</span>
              {t.genderMode === "half" ? (
                <span>
                  남 {t.currentM}/{t.minM ?? "-"} · 여 {t.currentF}/{t.minF ?? "-"}
                </span>
              ) : (
                <span>인원 {t.currentM + t.currentF}/{t.minCount}</span>
              )}
              {t.openChatUrl ? (
                <span className="text-emerald-600 text-xs">오픈채팅 연결됨</span>
              ) : (
                <span className="text-amber-600 text-xs">오픈채팅 미입력</span>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

// ── 제안 + 전환 ──────────────────────────────────────────────────────────────────
function ProposalsSection() {
  const utils = trpc.useUtils();
  const { data: proposals } = trpc.bungaeting.proposals.list.useQuery();
  const [tripIds, setTripIds] = useState<Record<number, string>>({});
  const convert = trpc.bungaeting.proposals.convert.useMutation({
    onSuccess: (r) => {
      utils.bungaeting.proposals.list.invalidate();
      toast.success(`전환 완료 — 보상 ${r.rewardGranted ? "지급" : "이미지급"}, 알림 ${r.notifiedCount}건`);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <SectionShell title="회차 제안 / 찜">
      {!proposals || proposals.length === 0 ? (
        <p className="text-sm text-muted-foreground">열린 제안이 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {proposals.map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-3 text-sm space-y-1">
              <div className="font-medium">{p.eventTitle}</div>
              <div className="text-xs text-muted-foreground">{formatDateTime(p.proposedDate)} · 찜 {p.interestTotal}</div>
              <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                {Object.entries(p.interestByMode).map(([m, n]) => (
                  <span key={m} className="rounded-full border border-border px-1.5 py-0.5">{GENDER_MODE_LABELS[m] ?? m} {n}</span>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <Input
                  className="h-8 w-40" placeholder="연결할 트립 ID"
                  value={tripIds[p.id] ?? ""}
                  onChange={(e) => setTripIds((s) => ({ ...s, [p.id]: e.target.value }))}
                />
                <Button size="sm" disabled={!tripIds[p.id] || convert.isPending}
                  onClick={() => convert.mutate({ proposalId: p.id, tripId: Number(tripIds[p.id]) })}>
                  정식 회차로 전환
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

// ── 프로필 신고 처리 ─────────────────────────────────────────────────────────────
function ReportsSection() {
  const utils = trpc.useUtils();
  const { data: reports } = trpc.bungaeting.admin.listReports.useQuery();
  const resolve = trpc.bungaeting.admin.resolveReport.useMutation({
    onSuccess: () => { utils.bungaeting.admin.listReports.invalidate(); toast.success("신고를 처리했어요."); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <SectionShell title="프로필 신고">
      {!reports || reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">미처리 신고가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-3 text-sm space-y-1">
              <div>
                대상: <span className="font-medium">{r.targetNickname ?? `#${r.targetUserId}`}</span>
                {r.targetStatus && <Badge variant="outline" className="ml-1">{r.targetStatus}</Badge>}
              </div>
              {r.reason && <div className="text-xs text-muted-foreground">사유: {r.reason}</div>}
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate({ reportId: r.id, action: "blind" })}>블라인드</Button>
                <Button size="sm" variant="destructive" disabled={resolve.isPending} onClick={() => resolve.mutate({ reportId: r.id, action: "restrict" })}>이용제한</Button>
                <Button size="sm" variant="ghost" disabled={resolve.isPending} onClick={() => resolve.mutate({ reportId: r.id, action: "dismiss" })}>기각</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

// ── 알림 발송 (성별 단독 타겟 없음, §4-5) ────────────────────────────────────────
function NotificationSection() {
  const [target, setTarget] = useState<"trip" | "optIn">("optIn");
  const [tripId, setTripId] = useState("");
  const [message, setMessage] = useState("");
  const send = trpc.bungaeting.admin.sendNotification.useMutation({
    onSuccess: (r) => { toast.success(`${r.sentCount}건 발송(mock)`); setMessage(""); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <SectionShell title="알림 발송 (SMS mock)">
      <div className="space-y-2">
        <div className="flex gap-2">
          <select value={target} onChange={(e) => setTarget(e.target.value as "trip" | "optIn")} className="rounded-md border border-border bg-white px-3 py-2 text-sm">
            <option value="optIn">알림 동의 선호등록자 전원</option>
            <option value="trip">특정 회차 참가자</option>
          </select>
          {target === "trip" && <Input className="w-32" placeholder="트립 ID" value={tripId} onChange={(e) => setTripId(e.target.value)} />}
        </div>
        <Textarea rows={2} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="발송 메시지" />
        <Button
          disabled={!message.trim() || (target === "trip" && !tripId) || send.isPending}
          onClick={() => send.mutate({ target, tripId: target === "trip" ? Number(tripId) : undefined, message: message.trim() })}
        >
          발송
        </Button>
        <p className="text-[11px] text-muted-foreground">※ 특정 성별에게만 보내는 옵션은 제공하지 않습니다 (동의자 전원 동일 발송).</p>
      </div>
    </SectionShell>
  );
}

// ── 공용 셸 ──────────────────────────────────────────────────────────────────────
function SectionShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-white p-4">
      <h3 className="font-semibold mb-3">{title}</h3>
      {children}
    </section>
  );
}
