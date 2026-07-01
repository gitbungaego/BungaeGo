import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  formatDate,
  formatPrice,
} from "@/lib/constants";
import { Bus, MapPin, Search, Users } from "lucide-react";

const CATEGORIES = ["all", "concert", "sports", "festival", "awards", "exhibition", "other"];

export default function EventsPage() {
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const { data: events, isLoading } = trpc.events.list.useQuery({
    category: category === "all" ? undefined : category,
    search: search || undefined,
    limit: 24,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  return (
    <div className="py-10">
      <div className="container">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">이벤트</h1>
          <p className="text-muted-foreground">원하는 이벤트의 셔틀을 찾아보세요</p>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="relative mb-6 max-w-lg">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="이벤트명, 장소 검색..."
            className="pl-10 pr-24 h-11 rounded-xl border-border/80"
          />
          <Button
            type="submit"
            size="sm"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-3"
          >
            검색
          </Button>
        </form>

        {/* Category Filter */}
        <div className="flex flex-wrap gap-2 mb-8">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all duration-200 ${
                category === cat
                  ? "bg-primary text-white border-primary shadow-sm shadow-primary/20"
                  : "bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border overflow-hidden">
                <Skeleton className="h-44 w-full" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : events && events.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        ) : (
          <div className="text-center py-24 text-muted-foreground">
            <Bus className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="font-medium">이벤트가 없습니다</p>
            <p className="text-sm mt-1">다른 카테고리나 검색어를 시도해보세요</p>
          </div>
        )}
      </div>
    </div>
  );
}

function EventCard({ event }: { event: any }) {
  const { data: trips } = trpc.trips.byEventId.useQuery({ eventId: event.id });
  const totalSeats = trips?.reduce((s, t) => s + t.currentCount, 0) ?? 0;
  const hasConfirmed = trips?.some((t) => t.status === "confirmed");

  return (
    <Link href={`/events/${event.id}`}>
      <div className="group rounded-2xl border border-border bg-card overflow-hidden card-hover cursor-pointer h-full flex flex-col">
        {/* Image */}
        <div className="relative h-44 bg-muted overflow-hidden flex-shrink-0">
          {event.imageUrl ? (
            <img
              src={event.imageUrl}
              alt={event.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-purple-100">
              <Bus className="h-12 w-12 text-primary/30" />
            </div>
          )}
          <div className="absolute top-3 left-3 flex gap-1.5">
            <Badge
              variant="outline"
              className={`text-xs font-medium border ${CATEGORY_COLORS[event.category] ?? ""} bg-white/90`}
            >
              {CATEGORY_LABELS[event.category] ?? event.category}
            </Badge>
            {hasConfirmed && (
              <Badge className="text-xs bg-emerald-500 text-white border-0">
                확정됨!
              </Badge>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="p-4 flex flex-col flex-1">
          <h3 className="font-semibold text-sm leading-snug line-clamp-2 mb-2 flex-1">
            {event.title}
          </h3>
          <div className="space-y-1.5 mt-auto">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{event.venue}</span>
            </div>
            <p className="text-xs text-muted-foreground">{formatDate(event.eventDate)}</p>
            {trips && trips.length > 0 && (
              <div className="flex items-center justify-between pt-1 border-t border-border/60 mt-2">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" />
                  <span>{totalSeats}명 탑승 예정</span>
                </div>
                <span className="text-xs font-medium text-primary">
                  셔틀 {trips.length}개
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
