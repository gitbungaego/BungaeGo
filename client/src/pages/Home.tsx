import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { ArrowRight, Bus, CalendarDays, ChevronRight, MapPin, Share2, Users, Zap } from "lucide-react";
import { Link } from "wouter";
import { CATEGORY_COLORS, CATEGORY_LABELS, formatDate } from "@/lib/constants";

// 앱 스타일 홈 — 마케팅 랜딩이 아니라 앱 첫 화면처럼: 컴팩트 히어로, 빠른 액션,
// 가로 스크롤 이벤트 카드. 상단 브랜드 바·하단 탭은 AppShell이 그린다.
export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const { data: events } = trpc.events.list.useQuery({ limit: 6 });

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

        {/* 빠른 액션 */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <Link
            href="/events"
            className="flex items-center justify-between rounded-2xl bg-primary text-white p-4 shadow-md shadow-primary/25 active:scale-[0.98] transition-transform"
          >
            <div>
              <p className="font-semibold text-sm">이벤트 보기</p>
              <p className="text-[11px] text-white/80 mt-0.5">셔틀 예약하기</p>
            </div>
            <CalendarDays className="h-6 w-6 opacity-80" />
          </Link>
          <Link
            href="/create"
            className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 active:scale-[0.98] transition-transform"
          >
            <div>
              <p className="font-semibold text-sm">셔틀 만들기</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">직접 노선 개설</p>
            </div>
            <Bus className="h-6 w-6 text-primary" />
          </Link>
        </div>
      </section>

      {/* 다가오는 이벤트 — 가로 스크롤 카드 */}
      {events && events.length > 0 && (
        <section className="pt-2">
          <div className="flex items-center justify-between px-4 mb-3">
            <h2 className="text-base font-bold">다가오는 이벤트</h2>
            <Link href="/events" className="flex items-center text-xs font-medium text-primary">
              전체 보기 <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory scrollbar-none">
            {events.map((event) => (
              <Link
                key={event.id}
                href={`/events/${event.id}`}
                className="snap-start shrink-0 w-[240px] rounded-2xl border border-border bg-card overflow-hidden active:scale-[0.98] transition-transform"
              >
                <div className="relative h-32 bg-muted overflow-hidden">
                  {event.imageUrl ? (
                    <img src={event.imageUrl} alt={event.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-purple-100">
                      <Bus className="h-10 w-10 text-primary/30" />
                    </div>
                  )}
                  <div className="absolute top-2 left-2">
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-medium border ${CATEGORY_COLORS[event.category] ?? ""} bg-white/90`}
                    >
                      {CATEGORY_LABELS[event.category] ?? event.category}
                    </Badge>
                  </div>
                </div>
                <div className="p-3">
                  <h3 className="font-semibold text-[13px] leading-snug line-clamp-2 mb-1.5">{event.title}</h3>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <MapPin className="h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{event.venue}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(event.eventDate)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

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
