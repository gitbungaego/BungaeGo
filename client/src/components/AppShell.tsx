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
import { Check, ChevronLeft, Globe, Home, PlusCircle, User } from "lucide-react";
import { useLocale, useT } from "@/i18n";
import { LOCALES } from "@/i18n/locales";

// 번개GO 로고 색(노란 버스).
const LOGO_YELLOW = "#F6B500";

// 이벤트 탭 — 번개GO 로고에서 번개(⚡)만 뺀 버스 마크(눈·미소·다리 포함).
function EventBusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="4.5" y="3" width="15" height="16.5" rx="3.4" fill={LOGO_YELLOW} />
      <rect x="4.5" y="10.7" width="15" height="1.1" fill="#fff" />
      <circle cx="9" cy="14.4" r="1.3" fill="#fff" />
      <circle cx="15" cy="14.4" r="1.3" fill="#fff" />
      <path d="M9 16.5c1 1.25 5 1.25 6 0" stroke="#fff" strokeWidth="1.25" strokeLinecap="round" />
      <rect x="7" y="19.3" width="1.7" height="2.3" rx="0.6" fill={LOGO_YELLOW} />
      <rect x="9.1" y="19.3" width="1.7" height="2.3" rx="0.6" fill={LOGO_YELLOW} />
      <rect x="13.2" y="19.3" width="1.7" height="2.3" rx="0.6" fill={LOGO_YELLOW} />
      <rect x="15.3" y="19.3" width="1.7" height="2.3" rx="0.6" fill={LOGO_YELLOW} />
    </svg>
  );
}

// 번개팅 탭 — 원래 번개GO 로고(노란 버스 + 번개 표식) 이미지.
function BungaetingLogoIcon({ className }: { className?: string }) {
  return <img src="/logo.png" alt="" aria-hidden="true" className={`${className ?? ""} object-contain`} />;
}

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
const TABS: { href: string; labelKey: string; icon: React.ComponentType<{ className?: string }>; exact: boolean }[] = [
  { href: "/", labelKey: "nav.home", icon: Home, exact: true },
  { href: "/events", labelKey: "nav.events", icon: EventBusIcon, exact: false },
  // 만들기 = 셔틀 만들기(수요 모집). 실제 이벤트/셔틀 개설(/create)은 관리자 전용.
  { href: "/demand", labelKey: "nav.create", icon: PlusCircle, exact: false },
  ...(bungaetingEnabled ? [{ href: "/bungaeting", labelKey: "nav.bungaeting", icon: BungaetingLogoIcon, exact: false }] : []),
  { href: "/mypage", labelKey: "nav.my", icon: User, exact: false },
];

export function TabBar() {
  const [location] = useLocation();
  const t = useT();
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
              {t(tab.labelKey)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// ── 언어 스위처 (지구본) ────────────────────────────────────────────────────────
export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label={t("lang.title")}
        >
          <Globe className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onClick={() => setLocale(l.code)}
            className="cursor-pointer flex items-center justify-between"
          >
            {l.label}
            {locale === l.code && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── 상단 앱바 ──────────────────────────────────────────────────────────────────
function BrandHeader() {
  const { user, isAuthenticated, logout } = useAuth();
  const t = useT();
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-white/90 backdrop-blur">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-1.5">
          <img src="/logo.png" alt="번개GO" className="h-7 w-auto" />
          <span className="font-bold tracking-tight">
            <span className="text-primary">번개</span>GO
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
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
                  <p className="text-sm font-medium truncate">{user?.name ?? t("header.user")}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/mypage" className="cursor-pointer">{t("header.mypage")}</Link>
                </DropdownMenuItem>
                {user?.role === "admin" && (
                  <DropdownMenuItem asChild>
                    <Link href="/admin" className="cursor-pointer">{t("header.admin")}</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                  {t("header.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" asChild className="h-8 bg-[#FEE500] hover:bg-[#FDD800] text-black border-0 text-xs">
              <a href={getLoginUrl()}>{t("header.login")}</a>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function SubHeader({ title, titleKey }: { title?: string; titleKey?: string }) {
  const t = useT();
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-white/90 backdrop-blur">
      <div className="flex h-12 items-center gap-1 px-2">
        <button
          onClick={() => window.history.back()}
          className="p-2 rounded-lg hover:bg-muted transition-colors"
          aria-label={t("common.back")}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="font-semibold text-[15px] truncate flex-1">{titleKey ? t(titleKey) : title}</span>
        <LanguageSwitcher />
      </div>
    </header>
  );
}

// ── 셸 ────────────────────────────────────────────────────────────────────────
interface AppShellProps {
  children: React.ReactNode;
  /** 서브 페이지 타이틀(고정 문자열). 지정 시 back 헤더, 미지정 시 브랜드 헤더. */
  title?: string;
  /** 번역된 서브 페이지 타이틀 catalog 키 (title보다 우선). */
  titleKey?: string;
  /** 신청/결제 플로우 등 탭 없이 전체 화면으로 쓸 때. */
  hideTabs?: boolean;
  /** 상단 헤더 자체를 숨길 때 (페이지가 자체 헤더를 그리는 경우). */
  hideHeader?: boolean;
}

export default function AppShell({ children, title, titleKey, hideTabs = false, hideHeader = false }: AppShellProps) {
  const showSubHeader = title !== undefined || titleKey !== undefined;
  return (
    <div className={`relative mx-auto w-full ${FRAME_MAX_W} min-h-dvh bg-background flex flex-col shadow-[0_0_36px_rgba(0,0,0,0.10)]`}>
      {!hideHeader && (showSubHeader ? <SubHeader title={title} titleKey={titleKey} /> : <BrandHeader />)}
      <main className={`flex-1 page-enter ${hideTabs ? "" : "pb-20"}`}>{children}</main>
      {!hideTabs && <TabBar />}
    </div>
  );
}
