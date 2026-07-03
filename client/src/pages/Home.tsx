import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { ArrowRight, Bus, MapPin, Share2, Star, Users, Zap } from "lucide-react";
import { Link } from "wouter";
import { CATEGORY_COLORS, CATEGORY_LABELS, formatDate, formatPrice } from "@/lib/constants";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export default function Home() {
  const { isAuthenticated } = useAuth();
  const { data: events } = trpc.events.list.useQuery({ limit: 3 });

  const features = [
    {
      icon: <Users className="h-5 w-5" />,
      title: "크라우드소싱 셔틀",
      desc: "최소 인원이 모이면 자동으로 셔틀이 확정됩니다.",
    },
    {
      icon: <MapPin className="h-5 w-5" />,
      title: "내 근처 탑승 포인트",
      desc: "가장 가까운 탑승 포인트를 선택하거나 직접 추가하세요.",
    },
    {
      icon: <Share2 className="h-5 w-5" />,
      title: "친구 초대 포인트",
      desc: "친구를 초대하면 양쪽 모두 포인트를 적립받습니다.",
    },
    {
      icon: <Zap className="h-5 w-5" />,
      title: "실시간 모집 현황",
      desc: "예약 현황을 실시간으로 확인하고 빠르게 결정하세요.",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-yellow-50/30 pt-20 pb-24">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent pointer-events-none" />
        <div className="container relative">
          <div className="max-w-2xl mx-auto text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium">
              <Zap className="h-3.5 w-3.5 fill-current" />
              번개처럼 빠른 셔틀 서비스
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
              콘서트·스포츠·페스티발
              <br />
              <span className="gradient-text">함께 타면 더 빠른게</span>
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              원하는 이벤트의 셔틀을 직접 만들고, 친구들과 공유해 버스를 채우세요.
              최소 인원이 모이면 셔틀이 자동으로 확정됩니다.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button size="lg" className="shadow-md shadow-primary/20 gap-2" asChild>
                <Link href="/events">
                  이벤트 둘러보기
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="gap-2" asChild>
                <Link href="/create">
                  <Bus className="h-4 w-4" />
                  셔틀 만들기
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold mb-3">왜 번개GO인가요?</h2>
            <p className="text-muted-foreground">크라우드소싱으로 더 스마트하게 이동하세요</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="group p-6 rounded-2xl border border-border bg-card hover:border-primary/30 hover:shadow-md transition-all duration-300"
              >
                <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-white transition-colors duration-300">
                  {f.icon}
                </div>
                <h3 className="font-semibold mb-1.5">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Upcoming Events */}
      {events && events.length > 0 && (
        <section className="py-20 bg-muted/20">
          <div className="container">
            <div className="flex items-center justify-between mb-10">
              <div>
                <h2 className="text-2xl font-bold mb-1">다가오는 이벤트</h2>
                <p className="text-muted-foreground text-sm">지금 셔틀을 예약하세요</p>
              </div>
              <Button variant="ghost" className="gap-1 text-primary" asChild>
                <Link href="/events">
                  전체 보기 <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {events.map((event) => (
                <Link key={event.id} href={`/events/${event.id}`}>
                  <div className="group rounded-2xl border border-border bg-card overflow-hidden card-hover cursor-pointer">
                    <div className="relative h-44 bg-muted overflow-hidden">
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
                      <div className="absolute top-3 left-3">
                        <Badge
                          variant="outline"
                          className={`text-xs font-medium border ${CATEGORY_COLORS[event.category] ?? ""} bg-white/90`}
                        >
                          {CATEGORY_LABELS[event.category] ?? event.category}
                        </Badge>
                      </div>
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-sm leading-snug line-clamp-2 mb-2">
                        {event.title}
                      </h3>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{event.venue}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDate(event.eventDate)}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="py-20 bg-primary">
        <div className="container text-center space-y-6">
          <h2 className="text-2xl font-bold text-white">지금 바로 셔틀을 만들어보세요</h2>
          <p className="text-primary-foreground/80 max-w-md mx-auto">
            원하는 이벤트의 셔틀이 없다면? 직접 만들고 친구들을 초대하세요.
          </p>
          <Button
            size="lg"
            variant="secondary"
            className="shadow-lg gap-2"
            asChild
          >
            {isAuthenticated ? (
              <Link href="/create">
                <Bus className="h-4 w-4" />
                셔틀 만들기 시작
              </Link>
            ) : (
              <a href={getLoginUrl()}>
                <Bus className="h-4 w-4" />
                셔틀 만들기 시작
              </a>
            )}
          </Button>
        </div>
      </section>

      <Footer />
    </div>
  );
}
