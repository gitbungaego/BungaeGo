import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatPrice } from "@/lib/constants";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Impact {
  tripCount: number;
  reservationCount: number;
  totalRefund: number;
}

export function EventDeleteDialog({ event, open, onOpenChange }: { event: { id: number; title: string } | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const [hard, setHard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null); // set when server asks for cascade confirm
  const [cascadeConfirmed, setCascadeConfirmed] = useState(false);

  useEffect(() => {
    if (open) {
      setHard(false);
      setError(null);
      setImpact(null);
      setCascadeConfirmed(false);
    }
  }, [open]);

  const del = trpc.admin.events.delete.useMutation({
    onSuccess: (r) => {
      if (r.mode === "needsConfirm") {
        // Event has reservations — show impact and require the cascade confirm.
        setImpact({ tripCount: r.tripCount, reservationCount: r.reservationCount, totalRefund: r.totalRefund });
        return;
      }
      if (r.mode === "cascade") {
        toast.success(`이벤트 삭제 완료 · 예약 ${r.reservationCount}건 환불 처리 · 알림 ${r.notifiedCount}건 발송`);
      } else if (r.mode === "hard") {
        toast.success("이벤트가 완전히 삭제되었습니다.");
      } else {
        toast.success("이벤트가 숨김 처리되었습니다.");
      }
      utils.events.adminList.invalidate();
      utils.reservations.adminList.invalidate();
      onOpenChange(false);
    },
    onError: (err) => setError(err.message),
  });

  const inCascadeConfirm = impact !== null;

  const onDelete = () => {
    if (!event) return;
    setError(null);
    del.mutate({ id: event.id, hard, confirmCascade: inCascadeConfirm });
  };

  const deleteDisabled = del.isPending || (inCascadeConfirm && !cascadeConfirmed);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{inCascadeConfirm ? "예약자가 있는 이벤트입니다" : "이벤트를 삭제하시겠습니까?"}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p className="font-medium text-foreground">{event?.title}</p>

              {inCascadeConfirm && impact ? (
                <>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    셔틀 <b>{impact.tripCount}개</b> · 예약 <b>{impact.reservationCount}건</b> · 예상 환불 총{" "}
                    <b>{formatPrice(impact.totalRefund)}</b>
                  </div>
                  <p>
                    삭제하면 <b>예약자 전원에게 전액 환불</b>하고 <b>취소 알림</b>을 보낸 뒤 이벤트를 숨김 처리합니다.
                    되돌릴 수 없습니다.
                  </p>
                  <label className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">
                    <input type="checkbox" className="mt-0.5" checked={cascadeConfirmed} onChange={(e) => setCascadeConfirmed(e.target.checked)} />
                    <span>예약자 전원에게 전액 환불하고 취소 알림을 보낸 뒤 삭제하는 것에 동의합니다.</span>
                  </label>
                </>
              ) : (
                <>
                  <p>
                    기본은 <b>숨김(soft delete)</b>입니다 — 공개 목록·검색에서 사라지지만 데이터는 보존되어 되돌릴 수 있습니다.
                  </p>
                  <label className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive">
                    <input type="checkbox" className="mt-0.5" checked={hard} onChange={(e) => { setHard(e.target.checked); setError(null); }} />
                    <span>
                      <b>완전 삭제 (되돌릴 수 없음)</b> — 이벤트·셔틀·정류장을 DB에서 영구 제거합니다. 예약이 있으면 거부됩니다.
                    </span>
                  </label>
                </>
              )}

              {error && <p className="text-sm text-destructive font-medium">{error}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleteDisabled}
            className="inline-flex items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
          >
            {del.isPending ? "처리 중..." : inCascadeConfirm ? "환불·알림 후 삭제" : hard ? "완전 삭제" : "숨기기"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
