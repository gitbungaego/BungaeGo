import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Bus } from "lucide-react";
import { CategoryIconChips, EventRow, MonthChips, filterAndSortEvents } from "@/components/EventBrowser";

// 셔틀 만들기 (수요 모집) — 등록된 이벤트 중 원하는 노선이 없을 때, 이벤트를 골라
// 희망 탑승지를 신청한다. 수요가 모이면 운영자가 셔틀을 오픈. (카카오T 수요조사 참고)
export default function DemandPage() {
  const [category, setCategory] = useState("all");
  const [monthKey, setMonthKey] = useState("popular");

  const { data: events, isLoading } = trpc.events.list.useQuery({
    category: category === "all" ? undefined : category,
    limit: 50,
  });
  const visibleEvents = filterAndSortEvents(events ?? [], monthKey);

  return (
    <div className="py-5">
      <div className="container space-y-3">
        <div>
          <h1 className="text-lg font-bold">수요가 많으면 오픈!</h1>
          <p className="text-sm text-muted-foreground">
            같이 모여서 셔틀 타요 🚌 원하는 이벤트를 고르고 희망 탑승지를 알려주세요.
          </p>
        </div>

        <CategoryIconChips value={category} onChange={setCategory} />
        <MonthChips events={events ?? []} value={monthKey} onChange={setMonthKey} />

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl border border-border px-3 py-2.5">
                <Skeleton className="h-16 w-12 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleEvents.length > 0 ? (
          <div className="space-y-2">
            {visibleEvents.map((event) => (
              <EventRow key={event.id} event={event} href={`/demand/${event.id}`} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            <Bus className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="font-medium">해당 조건의 이벤트가 없어요</p>
            <p className="text-sm mt-1">원하는 행사가 없다면 홈의 '이벤트 만들기'로 신청해 주세요.</p>
          </div>
        )}
      </div>
    </div>
  );
}
