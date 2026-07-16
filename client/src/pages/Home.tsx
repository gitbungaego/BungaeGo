import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { ArrowRight, Bus, CalendarDays, ChevronRight, MapPin, Share2, Users, Zap } from "lucide-react";
import { Link } from "wouter";
import { CategoryIconChips, EventRow, MonthChips, filterAndSortEvents } from "@/components/EventBrowser";

// 앱 스타일 홈 — 마케팅 랜딩이 아니라 앱 첫 화면처럼: 컴팩트 히어로, 빠른 액션,
// 가로 스크롤 이벤트 카드. 상단 브랜드 바·하단 탭은 AppShell이 그린다.
export default function Home() {
  const { user, isAuthenticated } = useAuth();
  // 모집중인 셔틀 (카카오T식): 카테고리는 서버 필터, 월/인기는 클라이언트 필터.
  const [category, setCategory] = useState("all");
  const [monthKey, setMonthKey] = useState("popular");
  const { data: events } = trpc.events.list.useQuery({
    category: category === "all" ? undefined : category,
    limit: 50,
  });
  const visibleEvents = filterAndSortEvents(events ?? [], monthKey).slice(0, 8);

  const features = [
    { icon: <Users className="h-4 w-4" />, title: "크라우드소싱 셔틀", desc: "최소 인원 모이면 자동 확정" },
    { icon: <MapPin className="h-4 w-4" />, title: "내 근처 탑승", desc: "가까운 탑승 포인트 선택" },
    { icon: <Share2 className="h-4 w-4" />, title: "친구 초대 포인트", desc: "초대하면 양쪽 모두 적립" },
    { icon: <Zap className="h-4 w-4" />, title: "실시간 모집 현황", desc: "예약 현황 바로 확인" },
  ];

  return (
    <div className="pb-4">
      {/* 히어로 — 앱 첫 화면 인사 */}
      <section className="px-4 pt-5 pb-6 bg-gradient-to-b from-primary/10 via-yellow-50/40 to-transparent">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-3">
          <Zap className="h-3 w-3 fill-current" />
          번개처럼 빠른 이벤트 셔틀
        </div>
        <h1 className="text-[22px] font-bold leading-snug tracking-tight">
          {isAuthenticated && user?.name ? (
            <>
              {user.name}님,
              <br />
              오늘은 어디로 갈까요? <span className="align-middle">🚌</span>
            </>
          ) : (
            <>
              콘서트·페스티벌,
              <br />
              <span className="gradient-text">함께 타면 더 빠르게</span>
            </>
          )}
        </h1>

        {/* 빠른 액션: 이벤트 만들기(미등록 행사 신청) / 셔틀 만들기(수요 모집) */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <Link
            href="/event-request"
            className="flex items-center justify-between rounded-2xl bg-primary text-white p-4 shadow-md shadow-primary/25 active:scale-[0.98] transition-transform"
          >
            <div>
              <p className="font-semibold text-sm">이벤트 만들기</p>
              <p className="text-[11px] text-white/80 mt-0.5">모든 행사 신청 가능</p>
            </div>
            <CalendarDays className="h-6 w-6 opacity-80" />
          </Link>
          <Link
            href="/demand"
            className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 active:scale-[0.98] transition-transform"
          >
            <div>
              <p className="font-semibold text-sm">셔틀 만들기</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">수요 모집</p>
            </div>
            <Bus className="h-6 w-6 text-primary" />
          </Link>
        </div>
      </section>

      {/* 모집중인 셔틀 — 카카오T 셔틀 스타일 (카테고리 아이콘 칩 + 월별 필터 + 리스트) */}
      <section className="px-4 pt-2 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">모집중인 셔틀</h2>
          <Link href="/events" className="flex items-center text-xs font-medium text-primary">
            전체 보기 <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <CategoryIconChips value={category} onChange={setCategory} />
        <MonthChips events={events ?? []} value={monthKey} onChange={setMonthKey} />

        {visibleEvents.length > 0 ? (
          <div className="space-y-2">
            {visibleEvents.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            해당 조건의 셔틀이 아직 없어요.
          </div>
        )}
      </section>

      {/* 왜 번개GO — 컴팩트 2×2 */}
      <section className="px-4 pt-6">
        <h2 className="text-base font-bold mb-3">왜 번개GO인가요?</h2>
        <div className="grid grid-cols-2 gap-2.5">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-card p-3.5">
              <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-2">
                {f.icon}
              </div>
              <h3 className="font-semibold text-[13px] mb-0.5">{f.title}</h3>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA 배너 */}
      <section className="px-4 pt-6">
        {isAuthenticated ? (
          <Link
            href="/create"
            className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-primary to-amber-400 text-white p-5 active:scale-[0.98] transition-transform"
          >
            <div>
              <p className="font-bold">원하는 셔틀이 없나요?</p>
              <p className="text-xs text-white/85 mt-1">직접 만들고 친구들을 초대하세요</p>
            </div>
            <ArrowRight className="h-5 w-5 shrink-0" />
          </Link>
        ) : (
          <a
            href={getLoginUrl()}
            className="flex items-center justify-between rounded-2xl bg-[#FEE500] text-black p-5 active:scale-[0.98] transition-transform"
          >
            <div>
              <p className="font-bold">카카오로 3초 만에 시작</p>
              <p className="text-xs text-black/70 mt-1">로그인하고 셔틀을 예약하세요</p>
            </div>
            <ArrowRight className="h-5 w-5 shrink-0" />
          </a>
        )}
      </section>
    </div>
  );
}
