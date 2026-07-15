import { Link, useLocation } from "wouter";
import { Heart, Home, Lightbulb, Sparkles, User } from "lucide-react";
import { FRAME_FIXED, FRAME_MAX_W } from "@/components/AppShell";

// 번개팅 서브 브랜드(옐로 톤) 레이아웃 + 하단 네비게이션 탭 (모바일 웹 기준, spec §3-1).
// 네이티브 앱이 아니므로 "하단 탭"은 fixed 하단 네비게이션 바로 구현.

const TABS = [
  { href: "/bungaeting", label: "홈", icon: Home, exact: true },
  { href: "/bungaeting/proposals", label: "제안", icon: Lightbulb, exact: false },
  { href: "/bungaeting/preferences", label: "선호", icon: Heart, exact: false },
  { href: "/bungaeting/me", label: "내 프로필", icon: User, exact: false },
];

export default function BungaetingLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const isActive = (href: string, exact: boolean) =>
    exact ? location === href : location.startsWith(href);

  return (
    // 전역 앱 셸과 동일한 폰 프레임 폭 — 번개팅 서브 앱도 같은 프레임 안에서 뜬다.
    <div className={`relative mx-auto w-full ${FRAME_MAX_W} min-h-dvh flex flex-col bg-[#FFFDF5] shadow-[0_0_36px_rgba(0,0,0,0.10)]`}>
      {/* 서브 브랜드 헤더 */}
      <header className="sticky top-0 z-40 border-b border-[#FEE500]/40 bg-[#FEE500]/95 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/bungaeting" className="flex items-center gap-1.5 font-bold text-black">
            <Sparkles className="h-5 w-5" />
            번개팅
          </Link>
          <Link href="/" className="text-xs font-medium text-black/60 hover:text-black">
            번개GO로 돌아가기
          </Link>
        </div>
      </header>

      {/* 본문 (하단 탭에 가리지 않도록 아래 여백) */}
      <main className="flex-1 page-enter pb-20">{children}</main>

      {/* 하단 네비게이션 탭 — 프레임 폭 고정 */}
      <nav className={`${FRAME_FIXED} bottom-0 z-40 border-t border-border/60 bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]`}>
        <div className="grid grid-cols-4">
          {TABS.map((tab) => {
            const active = isActive(tab.href, tab.exact);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${
                  active ? "text-black" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "fill-[#FEE500] stroke-black" : ""}`} />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
