import { useMemo } from "react";
import { Link } from "wouter";
import { Bus, ChevronRight } from "lucide-react";
import { CATEGORY_CHIPS, formatShortDate } from "@/lib/constants";

/**
 * 카카오T 셔틀 스타일 이벤트 브라우저 조각들 — Home("모집중인 셔틀")과 /events가 공유.
 * - CategoryIconChips: 원형 아이콘 카테고리 칩 (가로 스크롤)
 * - MonthChips: 인기 / N월 … (이벤트 있는 달만)
 * - EventRow: 세로 포스터(3:4) 썸네일 리스트 행
 * - filterAndSortEvents: 월/인기 필터·정렬 공통 로직
 */

export interface BrowsableEvent {
  id: number;
  title: string;
  category: string;
  eventDate: string | Date;
  venue: string;
  imageUrl: string | null;
  likeCount?: number;
}

// ── 카테고리 아이콘 칩 ──────────────────────────────────────────────────────────
export function CategoryIconChips({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto scrollbar-none -mx-4 px-4">
      {CATEGORY_CHIPS.map((c) => {
        const active = value === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onChange(c.key)}
            className="flex flex-col items-center gap-1 shrink-0 w-[62px] py-1"
          >
            <span
              className={`flex h-11 w-11 items-center justify-center rounded-full text-xl transition-all ${c.bg} ${
                active ? "ring-2 ring-primary ring-offset-1" : "opacity-90"
              }`}
            >
              {c.emoji}
            </span>
            <span className={`text-[11px] ${active ? "font-bold text-primary" : "text-muted-foreground"}`}>
              {c.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── 월별 필터 칩 ───────────────────────────────────────────────────────────────
// monthKey: "popular" | "YYYY-M" (예: "2026-9")
export function deriveMonthKeys(events: BrowsableEvent[]): string[] {
  const set = new Set<string>();
  for (const e of events) {
    const d = new Date(e.eventDate);
    set.add(`${d.getFullYear()}-${d.getMonth() + 1}`);
  }
  return Array.from(set).sort((a, b) => {
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    return ay - by || am - bm;
  });
}

export function MonthChips({
  events,
  value,
  onChange,
}: {
  events: BrowsableEvent[];
  value: string;
  onChange: (key: string) => void;
}) {
  const months = useMemo(() => deriveMonthKeys(events), [events]);
  const chips = [{ key: "popular", label: "인기" }, ...months.map((m) => ({ key: m, label: `${m.split("-")[1]}월` }))];
  return (
    <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-4 px-4">
      {chips.map((c) => {
        const active = value === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onChange(c.key)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              active
                ? "border-primary bg-primary/10 text-primary font-bold"
                : "border-border bg-white text-muted-foreground"
            }`}
          >
            {c.key === "popular" ? "🔥 " : ""}{c.label}
          </button>
        );
      })}
    </div>
  );
}

// ── 월/인기 필터·정렬 ──────────────────────────────────────────────────────────
export function filterAndSortEvents<T extends BrowsableEvent>(events: T[], monthKey: string): T[] {
  if (monthKey === "popular") {
    // 인기: 하트 수 내림차순 → 같은 수면 날짜 임박순
    return [...events].sort(
      (a, b) =>
        (b.likeCount ?? 0) - (a.likeCount ?? 0) ||
        new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime()
    );
  }
  return events
    .filter((e) => {
      const d = new Date(e.eventDate);
      return `${d.getFullYear()}-${d.getMonth() + 1}` === monthKey;
    })
    .sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());
}

// ── 리스트 행 (세로 포스터 3:4 썸네일) ─────────────────────────────────────────
export function EventRow({ event }: { event: BrowsableEvent }) {
  return (
    <Link
      href={`/events/${event.id}`}
      className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5 active:scale-[0.99] transition-transform"
    >
      <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
        {event.imageUrl ? (
          <img src={event.imageUrl} alt={event.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Bus className="h-5 w-5 text-muted-foreground/40" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-bold leading-snug">{event.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{event.venue}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{formatShortDate(event.eventDate)}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    </Link>
  );
}
