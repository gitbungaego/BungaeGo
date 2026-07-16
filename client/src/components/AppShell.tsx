import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CalendarDays, ChevronLeft, Home, PlusCircle, Sparkles, User } from "lucide-react";

/**
 * 앱 셸 — 웹 전체를 "모바일 앱"처럼 보이게 하는 폰 프레임 레이아웃.
 * PC에서도 화면 중앙에 폰 너비(430px) 프레임으로 뜨고(토스/당근 웹 스타일),
 * 하단 탭바 + 페이지별 상단 앱바를 제공한다. 관리자(/admin)만 이 셸 밖(데스크톱 폭).
 *
 * ⚠️ 프레임 안에서 `position: fixed`를 쓰는 모든 바(하단 CTA, 탭바 등)는 반드시
 * FRAME_FIXED 패턴을 써야 PC에서 뷰포트 전체로 퍼지지 않는다.
 */
export const FRAME_MAX_W = "max-w-[430px]";
export const FRAME_FIXED = `fixed inset-x-0 mx-auto w-full ${FRAME_MAX_W}`;

const bungaetingEnabled = import.meta.env.VITE_FEATURE_BUNGAETING === "true";

// ── 하단 탭바 ──────────────────────────────────────────────────────────────────
const TABS = [
  { href: "/", label: "홈", icon: Home, exact: true },
  { href: "/events", label: "이벤트", icon: CalendarDays, exact: false },
  // 만들기 = 셔틀 만들기(수요 모집). 실제 이벤트/셔틀 개설(/create)은 관리자 전용.
  { href: "/demand", label: "만들기", icon: PlusCircle, exact: false },
  ...(bungaetingEnabled ? [{ href: "/bungaeting", label: "번개팅", icon: Sparkles, exact: false }] : []),
  { href: "/mypage", label: "마이", icon: User, exact: false },
];

export function TabBar() {
  const [location] = useLocation();
  const isActive = (href: string, exact: boolean) =>
    exact ? location === href : location.startsWith(href);

  return (
    <nav className={`${FRAME_FIXED} bottom-0 z-40 border-t border-border bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]`}>
      <div className={`grid ${TABS.length === 5 ? "grid-cols-5" : "grid-cols-4"}`}>
        {TABS.map((tab) => {
          const active = isActive(tab.href, tab.exact);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? "stroke-[2.5]" : ""}`} />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// ── 상단 앱바 ──────────────────────────────────────────────────────────────────
function BrandHeader() {
  const { user, isAuthenticated, logout } = useAuth();
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-white/90 backdrop-blur">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-1.5">
          <img src="/logo.png" alt="번개GO" className="h-7 w-auto" />
          <span className="font-bold tracking-tight">
            <span className="text-primary">번개</span>GO
          </span>
        </Link>
        {isAuthenticated ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full p-0.5 hover:ring-2 hover:ring-primary/30 transition-all">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                    {user?.name?.[0]?.toUpperCase() ?? "U"}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <div className="px-3 py-2">
                <p className="text-sm font-medium truncate">{user?.name ?? "사용자"}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/mypage" className="cursor-pointer">마이페이지</Link>
              </DropdownMenuItem>
              {user?.role === "admin" && (
                <DropdownMenuItem asChild>
                  <Link href="/admin" className="cursor-pointer">관리자 대시보드</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                로그아웃
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button size="sm" asChild className="h-8 bg-[#FEE500] hover:bg-[#FDD800] text-black border-0 text-xs">
            <a href={getLoginUrl()}>카카오 로그인</a>
          </Button>
        )}
      </div>
    </header>
  );
}

function SubHeader({ title }: { title?: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-white/90 backdrop-blur">
      <div className="flex h-12 items-center gap-1 px-2">
        <button
          onClick={() => window.history.back()}
          className="p-2 rounded-lg hover:bg-muted transition-colors"
          aria-label="뒤로가기"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="font-semibold text-[15px] truncate">{title}</span>
      </div>
    </header>
  );
}

// ── 셸 ────────────────────────────────────────────────────────────────────────
interface AppShellProps {
  children: React.ReactNode;
  /** 서브 페이지 타이틀. 지정 시 back 헤더, 미지정 시 브랜드 헤더. */
  title?: string;
  /** 신청/결제 플로우 등 탭 없이 전체 화면으로 쓸 때. */
  hideTabs?: boolean;
  /** 상단 헤더 자체를 숨길 때 (페이지가 자체 헤더를 그리는 경우). */
  hideHeader?: boolean;
}

export default function AppShell({ children, title, hideTabs = false, hideHeader = false }: AppShellProps) {
  return (
    <div className={`relative mx-auto w-full ${FRAME_MAX_W} min-h-dvh bg-background flex flex-col shadow-[0_0_36px_rgba(0,0,0,0.10)]`}>
      {!hideHeader && (title !== undefined ? <SubHeader title={title} /> : <BrandHeader />)}
      <main className={`flex-1 page-enter ${hideTabs ? "" : "pb-20"}`}>{children}</main>
      {!hideTabs && <TabBar />}
    </div>
  );
}
