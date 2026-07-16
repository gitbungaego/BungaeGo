import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AdminTrip {
  id: number;
  status: string;
  mode: string;
  minCount: number;
  maxCount: number;
  price: number;
  oneWayPrice: number | null;
  departureAt: string | Date;
  isRoundTrip: boolean;
  notes: string | null;
}

function toLocalInput(d: string | Date): string {
  const dt = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function TripEditDialog({ trip, open, onOpenChange }: { trip: AdminTrip | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const isConfirmed = trip?.status === "confirmed";
  const [form, setForm] = useState({ minCount: 0, maxCount: 0, price: 0, oneWayPrice: "", departureAt: "", notes: "" });
  const [forceConfirmedEdit, setForceConfirmedEdit] = useState(false);

  useEffect(() => {
    if (!trip) return;
    setForm({
      minCount: trip.minCount,
      maxCount: trip.maxCount,
      price: trip.price,
      oneWayPrice: trip.oneWayPrice == null ? "" : String(trip.oneWayPrice),
      departureAt: toLocalInput(trip.departureAt),
      notes: trip.notes ?? "",
    });
    setForceConfirmedEdit(false);
  }, [trip]);

  const update = trpc.admin.trips.update.useMutation({
    onSuccess: () => {
      toast.success("노선이 수정되었습니다.");
      utils.trips.adminList.invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const formOneWay = form.oneWayPrice === "" ? null : Number(form.oneWayPrice);
  const priceChanged = !!trip && (form.price !== trip.price || formOneWay !== trip.oneWayPrice);
  const priceLocked = isConfirmed && !forceConfirmedEdit;

  const save = () => {
    if (!trip) return;
    if (form.minCount > form.maxCount) {
      toast.error("최소 인원은 최대 인원보다 클 수 없습니다.");
      return;
    }
    update.mutate({
      id: trip.id,
      minCount: form.minCount,
      maxCount: form.maxCount,
      // Don't send a locked price change at all.
      price: priceLocked ? undefined : form.price,
      oneWayPrice: priceLocked ? undefined : formOneWay,
      departureAt: form.departureAt ? new Date(form.departureAt).getTime() : undefined,
      notes: form.notes || undefined,
      forceConfirmedEdit,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>노선 편집 (#{trip?.id})</DialogTitle>
          <DialogDescription>정류장 개별 편집은 이벤트 상세에서 진행합니다.</DialogDescription>
        </DialogHeader>

        {isConfirmed && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">확정된 노선입니다.</p>
              <p>승객에게 이미 통보되어 <b>가격·정류장</b> 변경은 위험합니다. 오타·메모 수정만 권장합니다.</p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>최소 인원</Label>
              <Input type="number" value={form.minCount} onChange={(e) => setForm((f) => ({ ...f, minCount: Number(e.target.value) }))} />
            </div>
            <div className="space-y-1.5">
              <Label>최대 인원</Label>
              <Input type="number" value={form.maxCount} onChange={(e) => setForm((f) => ({ ...f, maxCount: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>1인 요금 (원){trip?.isRoundTrip ? " — 왕복" : ""}</Label>
            <Input
              type="number"
              value={form.price}
              disabled={priceLocked}
              onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))}
            />
            {trip?.isRoundTrip && (
              <>
                <Label className="pt-1 block">편도 요금 (원) — 행사장행/귀가행</Label>
                <Input
                  type="number"
                  value={form.oneWayPrice}
                  disabled={priceLocked}
                  placeholder="비우면 편도 탑승권 미판매"
                  onChange={(e) => setForm((f) => ({ ...f, oneWayPrice: e.target.value }))}
                />
              </>
            )}
            {isConfirmed && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                <input type="checkbox" checked={forceConfirmedEdit} onChange={(e) => setForceConfirmedEdit(e.target.checked)} />
                확정 노선의 가격 변경을 허용 (승객 통보 영향 확인)
              </label>
            )}
            {priceLocked && priceChanged && (
              <p className="text-xs text-amber-600">가격 변경은 위 확인란을 체크해야 저장됩니다.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>출발 일시</Label>
            <Input type="datetime-local" value={form.departureAt} onChange={(e) => setForm((f) => ({ ...f, departureAt: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>안내 메모</Label>
            <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={save} disabled={update.isPending}>{update.isPending ? "저장 중..." : "저장"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
