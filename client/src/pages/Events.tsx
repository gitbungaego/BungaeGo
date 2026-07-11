import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { HeartButton } from "@/components/HeartButton";
import { CATEGORY_LABELS, formatDate, formatPrice, formatTime } from "@/lib/constants";
import { Bus, Calendar, MapPin, Search } from "lucide-react";

const CATEGORIES = ["all", "concert", "sports", "festival", "rally", "exhibition", "other"];

type EventListItem = {
  id: number;
  title: string;
  category: string;
  eventDate: string | Date;
  venue: string;
  imageUrl: string | null;
  likeCount: number;
  myLiked: boolean;
};

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
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">이벤트</h1>
          <p className="text-muted-foreground">원하는 이벤트의 셔틀을 찾아보세요</p>
        </div>

        <form onSubmit={handleSearch} className="relative mb-5 max-w-lg">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="이벤트명, 장소 검색..."
            className="pl-10 pr-24 h-11 rounded-xl border-border/80"
          />
          <Button type="submit" size="sm" className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-3">
            검색
          </Button>
        </form>

        <div className="flex flex-wrap gap-2 mb-8">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all duration-200 ${
                category === cat
                  ? "bg-primary text-black border-primary shadow-sm shadow-primary/20"
                  : "bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border overflow-hidden">
                <Skeleton className="aspect-video w-full" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : events && events.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
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

function EventCard({ event }: { event: EventListItem }) {
  // Per-event trips give the lowest price and a coarse status for the badge.
  const { data: trips } = trpc.trips.byEventId.useQuery({ eventId: event.id });
  const activeTrips = (trips ?? []).filter((t) => t.status !== "cancelled");
  const lowestPrice = activeTrips.length ? Math.min(...activeTrips.map((t) => t.price)) : null;

  let statusChip: { label: string; className: string } | null = null;
  if (trips && trips.length > 0) {
    if (trips.some((t) => t.status === "confirmed")) {
      statusChip = { label: "확정", className: "bg-emerald-500 text-white" };
    } else if (activeTrips.length > 0 && activeTrips.every((t) => t.availability.remaining <= 0)) {
      statusChip = { label: "마감", className: "bg-gray-500 text-white" };
    } else {
      statusChip = { label: "모집중", className: "bg-primary text-black" };
    }
  }

  return (
    <Link href={`/events/${event.id}`}>
      <div className="group relative rounded-2xl border border-border bg-card overflow-hidden card-hover cursor-pointer h-full flex flex-col">
        <div className="relative aspect-video bg-muted overflow-hidden flex-shrink-0">
          {event.imageUrl ? (
            <img
              src={event.imageUrl}
              alt={event.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary via-amber-400 to-orange-400">
              <Bus className="h-12 w-12 text-white/70" />
            </div>
          )}
          {statusChip && (
            <Badge className={`absolute top-3 left-3 text-xs border-0 ${statusChip.className}`}>{statusChip.label}</Badge>
          )}
          <div className="absolute top-2.5 right-2.5">
            <HeartButton
              eventId={event.id}
              liked={event.myLiked}
              count={event.likeCount}
              size="sm"
              returnTo="/events"
            />
          </div>
        </div>

        <div className="p-4 flex flex-col flex-1">
          <h3 className="font-semibold text-sm leading-snug line-clamp-2 mb-2">{event.title}</h3>
          <div className="space-y-1 mt-auto">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3 flex-shrink-0" />
              {formatDate(event.eventDate)} {formatTime(event.eventDate)}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{event.venue}</span>
            </p>
            {lowestPrice !== null && (
              <p className="pt-1 text-base font-bold text-foreground">
                {formatPrice(lowestPrice)}
                <span className="text-xs font-medium text-muted-foreground">~</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
