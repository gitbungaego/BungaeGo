import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Soft-deletes a trip (cancel). If it has active reservations the server
// rejects the first attempt with a precondition message; the dialog then
// surfaces that and offers a second, explicit "refund everyone and delete".
export function TripDeleteDialog({ trip, open, onOpenChange }: { trip: { id: number } | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const [needsRefundConfirm, setNeedsRefundConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (open) setNeedsRefundConfirm(null);
  }, [open]);

  const del = trpc.admin.trips.delete.useMutation({
    onSuccess: (r) => {
      toast.success(r.refundedCount > 0 ? `예약 ${r.refundedCount}건 환불 후 삭제되었습니다.` : "노선이 삭제되었습니다.");
      utils.trips.adminList.invalidate();
      utils.reservations.adminList.invalidate();
      onOpenChange(false);
    },
    onError: (err) => {
      // PRECONDITION_FAILED → active reservations exist; escalate to refund path.
      setNeedsRefundConfirm(err.message);
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>노선을 삭제하시겠습니까?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>노선 #{trip?.id}을(를) 취소 상태로 삭제합니다. 되돌릴 수 없습니다.</p>
              {needsRefundConfirm && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-700">{needsRefundConfirm}</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <button
            type="button"
            onClick={() => { if (trip) del.mutate({ id: trip.id, confirmRefund: needsRefundConfirm !== null }); }}
            disabled={del.isPending}
            className="inline-flex items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
          >
            {del.isPending ? "처리 중..." : needsRefundConfirm ? "전원 환불 후 삭제" : "삭제"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
