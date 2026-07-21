import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Bus, Search } from "lucide-react";
import { CategoryIconChips, EventRow, MonthChips, filterAndSortEvents } from "@/components/EventBrowser";
import { useT } from "@/i18n";

// 이벤트 전체 보기 — 카카오T 셔틀 스타일 (카테고리 아이콘 칩 + 월별 필터 + 세로 포스터 리스트).
export default function EventsPage() {
  const t = useT();
  const [category, setCategory] = useState("all");
  const [monthKey, setMonthKey] = useState("popular");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  // Search-as-you-type: the query fires 300ms after the last keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data: events, isLoading } = trpc.events.list.useQuery({
    category: category === "all" ? undefined : category,
    search: search || undefined,
    limit: 50,
  });

  const visibleEvents = filterAndSortEvents(events ?? [], monthKey);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  return (
    <div className="py-5">
      <div className="container space-y-3">
        <h1 className="text-lg font-bold">{t("events.title")}</h1>

        <form onSubmit={handleSearch} className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("events.searchPlaceholder")}
            className="pl-10 pr-20 h-11 rounded-xl border-border/80"
          />
          <Button type="submit" size="sm" className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-3">
            {t("events.search")}
          </Button>
        </form>

        <CategoryIconChips value={category} onChange={setCategory} />
        <MonthChips events={events ?? []} value={monthKey} onChange={setMonthKey} />

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl border border-border px-3 py-2.5">
                <Skeleton className="h-16 w-12 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleEvents.length > 0 ? (
          <div className="space-y-2">
            {visibleEvents.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            <Bus className="h-12 w-12 mx-auto mb-4 opacity-20" />
            {search ? (
              <>
                <p className="font-medium">{t("events.noResult", { q: search })}</p>
                <p className="text-sm mt-1">{t("events.noResultHint")}</p>
              </>
            ) : (
              <p className="font-medium">{t("events.emptyFilter")}</p>
            )}
            {(search || category !== "all" || monthKey !== "popular") && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setSearchInput("");
                  setSearch("");
                  setCategory("all");
                  setMonthKey("popular");
                }}
              >
                {t("events.resetFilter")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
