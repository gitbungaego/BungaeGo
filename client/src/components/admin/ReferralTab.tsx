import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatPrice } from "@/lib/constants";

// 관리자 '레퍼럴' 탭 — FLAGGED 추천 건 검토(승인/거부) + 교차 입력 모니터링
// (referral-credit-spec §7-5, §7-6).
export function ReferralTab() {
  return (
    <div className="space-y-8">
      <FlaggedSection />
      <CrossUsageSection />
    </div>
  );
}

function FlaggedSection() {
  const utils = trpc.useUtils();
  const { data: entries, isLoading } = trpc.admin.referral.listFlagged.useQuery();
  const resolve = trpc.admin.referral.resolve.useMutation({
    onSuccess: () => {
      utils.admin.referral.listFlagged.invalidate();
      toast.success("처리되었습니다.");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <section className="rounded-xl border border-border bg-white p-4">
      <h3 className="font-semibold mb-1">지급 보류(FLAGGED) 추천 건</h3>
      <p className="text-xs text-muted-foreground mb-3">
        승인하면 대기(PENDING)로 복귀하고, 셔틀이 이미 운행 완료면 즉시 지급됩니다.
      </p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : !entries || entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">검토할 건이 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-3 text-sm space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{e.code}</span>
                <Badge className="bg-amber-100 text-amber-700 border-0">보류</Badge>
                <Badge variant="outline">{e.referrerIsParticipant ? "참가자 요율" : "기본 요율"} {Number(e.appliedRate) * 100}%</Badge>
              </div>
              <p className="text-xs">
                추천인 <b>{e.referrerName ?? `#${e.referrerUserId}`}</b> ← 결제자{" "}
                <b>{e.payerName ?? `#${e.payerUserId}`}</b> · 트립 #{e.tripId} · 실결제{" "}
                {formatPrice(e.paidAmount)}
              </p>
              {e.flagReason && <p className="text-xs text-destructive">사유: {e.flagReason}</p>}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-muted-foreground">{formatDateTime(e.createdAt)}</span>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ id: e.id, action: "approve" })}
                  >
                    승인
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive border-destructive/30"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ id: e.id, action: "reject" })}
                  >
                    거부
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CrossUsageSection() {
  const { data: pairs, isLoading } = trpc.admin.referral.crossUsage.useQuery();
  return (
    <section className="rounded-xl border border-border bg-white p-4">
      <h3 className="font-semibold mb-1">교차 입력 모니터링</h3>
      <p className="text-xs text-muted-foreground mb-3">
        서로의 코드를 입력한 유저 쌍 (사실상 상호 할인 — 파일럿에서는 허용, 과도해지면 요율 조정).
      </p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : !pairs || pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">교차 입력 패턴이 없습니다.</p>
      ) : (
        <div className="space-y-1.5">
          {pairs.map((p) => (
            <div key={`${p.userA}-${p.userB}`} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
              <span>
                <b>{p.userAName ?? `#${p.userA}`}</b> ↔ <b>{p.userBName ?? `#${p.userB}`}</b>
              </span>
              <span className="text-xs text-muted-foreground">
                {p.aToB}건 / {p.bToA}건
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
