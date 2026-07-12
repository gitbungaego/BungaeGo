import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function EventDeleteDialog({ event, open, onOpenChange }: { event: { id: number; title: string } | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const [hard, setHard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setHard(false);
      setError(null);
    }
  }, [open]);

  const del = trpc.admin.events.delete.useMutation({
    onSuccess: (r) => {
      toast.success(r.mode === "hard" ? "이벤트가 완전히 삭제되었습니다." : "이벤트가 숨김 처리되었습니다.");
      utils.events.adminList.invalidate();
      onOpenChange(false);
    },
    onError: (err) => setError(err.message),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>이벤트를 삭제하시겠습니까?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p className="font-medium text-foreground">{event?.title}</p>
              <p>
                기본은 <b>숨김(soft delete)</b>입니다 — 공개 목록·검색에서 사라지지만 데이터는 보존되어 되돌릴 수 있습니다.
              </p>
              <label className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive">
                <input type="checkbox" className="mt-0.5" checked={hard} onChange={(e) => { setHard(e.target.checked); setError(null); }} />
                <span>
                  <b>완전 삭제 (되돌릴 수 없음)</b> — 이벤트·셔틀·정류장을 DB에서 영구 제거합니다. 예약이 있으면 거부됩니다.
                </span>
              </label>
              {error && <p className="text-sm text-destructive font-medium">{error}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          {/* Not AlertDialogAction so a precondition error keeps the dialog open. */}
          <button
            type="button"
            onClick={() => { if (event) { setError(null); del.mutate({ id: event.id, hard }); } }}
            disabled={del.isPending}
            className="inline-flex items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
          >
            {del.isPending ? "삭제 중..." : hard ? "완전 삭제" : "숨기기"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
