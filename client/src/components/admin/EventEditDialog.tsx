import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { CATEGORY_LABELS } from "@/lib/constants";
import { ImageUrlField } from "@/components/ImageUrlField";

const CATEGORIES = ["concert", "sports", "festival", "rally", "exhibition", "other"] as const;

interface AdminEvent {
  id: number;
  title: string;
  category: string;
  eventDate: string | Date;
  venue: string;
  address: string | null;
  imageUrl: string | null;
  description: string | null;
  organizerName: string | null;
  searchAliases: string | null;
  tags: string | null;
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(d: string | Date): string {
  const dt = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function EventEditDialog({ event, open, onOpenChange }: { event: AdminEvent | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    title: "", category: "concert", eventDate: "", venue: "", address: "",
    imageUrl: "", description: "", organizerName: "", searchAliases: "", tags: "",
  });

  useEffect(() => {
    if (!event) return;
    setForm({
      title: event.title,
      category: event.category,
      eventDate: toLocalInput(event.eventDate),
      venue: event.venue,
      address: event.address ?? "",
      imageUrl: event.imageUrl ?? "",
      description: event.description ?? "",
      organizerName: event.organizerName ?? "",
      searchAliases: event.searchAliases ?? "",
      tags: event.tags ?? "",
    });
  }, [event]);

  const update = trpc.admin.events.update.useMutation({
    onSuccess: () => {
      toast.success("이벤트가 수정되었습니다.");
      utils.events.adminList.invalidate();
      utils.events.byId.invalidate({ id: event!.id });
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = () => {
    if (!event) return;
    if (form.title.trim().length < 2 || form.venue.trim().length < 2) {
      toast.error("이벤트명과 장소는 2자 이상이어야 합니다.");
      return;
    }
    const ms = form.eventDate ? new Date(form.eventDate).getTime() : undefined;
    update.mutate({
      id: event.id,
      title: form.title,
      category: form.category as (typeof CATEGORIES)[number],
      eventDate: ms,
      venue: form.venue,
      address: form.address || undefined,
      imageUrl: form.imageUrl || undefined,
      description: form.description || undefined,
      organizerName: form.organizerName || undefined,
      searchAliases: form.searchAliases || undefined,
      tags: form.tags || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>이벤트 편집</DialogTitle>
          <DialogDescription>관리자는 소유자와 무관하게 모든 이벤트를 편집할 수 있습니다.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>이벤트명</Label>
            <Input value={form.title} onChange={set("title")} />
          </div>
          <div className="space-y-1.5">
            <Label>카테고리</Label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, category: c }))}
                  className={`px-2.5 py-1 rounded-full text-xs border ${form.category === c ? "bg-primary text-black border-primary" : "border-border text-muted-foreground"}`}
                >
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>일시</Label>
              <Input type="datetime-local" value={form.eventDate} onChange={set("eventDate")} />
            </div>
            <div className="space-y-1.5">
              <Label>장소</Label>
              <Input value={form.venue} onChange={set("venue")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>주소</Label>
            <Input value={form.address} onChange={set("address")} />
          </div>
          <div className="space-y-1.5">
            <Label>주최</Label>
            <Input value={form.organizerName} onChange={set("organizerName")} />
          </div>
          <ImageUrlField
            label="이미지 URL"
            value={form.imageUrl}
            onChange={(v) => setForm((f) => ({ ...f, imageUrl: v }))}
          />
          <div className="space-y-1.5">
            <Label>설명</Label>
            <Textarea value={form.description} onChange={set("description")} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>태그 (쉼표구분)</Label>
            <Input value={form.tags} onChange={set("tags")} placeholder="K-POP,고척돔" />
          </div>
          <div className="space-y-1.5">
            <Label>검색 별칭 (쉼표구분, 비노출)</Label>
            <Input value={form.searchAliases} onChange={set("searchAliases")} placeholder="코르티스,cortis" />
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
