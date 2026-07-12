import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Enable auto-matching with a per-seat cap price. Replaces the old
// window.prompt with a proper modal.
export function AutoMatchDialog({ event, open, onOpenChange }: { event: { id: number; title: string; autoMatchPricePerSeat: number | null } | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const [price, setPrice] = useState("");

  useEffect(() => {
    if (open && event) setPrice(event.autoMatchPricePerSeat ? String(event.autoMatchPricePerSeat) : "");
  }, [open, event]);

  const setAutoMatch = trpc.events.setAutoMatch.useMutation({
    onSuccess: () => {
      toast.success("자동 매칭이 켜졌습니다.");
      utils.events.adminList.invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const enable = () => {
    if (!event) return;
    const p = Number(price);
    if (!Number.isFinite(p) || p < 0) {
      toast.error("올바른 가격을 입력하세요.");
      return;
    }
    setAutoMatch.mutate({ id: event.id, autoMatchEnabled: true, autoMatchPricePerSeat: p });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>자동 매칭 켜기</DialogTitle>
          <DialogDescription>{event?.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>좌석당 상한가 (원)</Label>
          <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="예: 20000" min={0} />
          <p className="text-xs text-muted-foreground">참가자는 이 금액을 선결제하고, 배차 확정 시 차액이 환불됩니다.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={enable} disabled={setAutoMatch.isPending}>{setAutoMatch.isPending ? "설정 중..." : "켜기"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
