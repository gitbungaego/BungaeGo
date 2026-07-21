import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LocaleProvider } from "./i18n";
import AppShell from "./components/AppShell";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import EventsPage from "./pages/Events";
import EventDetailPage from "./pages/EventDetail";
import BookingPage from "./pages/Booking";
import BookingConfirmPage from "./pages/BookingConfirm";
import RequestJoinPage from "./pages/RequestJoin";
import RequestJoinConfirmPage from "./pages/RequestJoinConfirm";
import { TossPaymentFailPage, TossPaymentSuccessPage } from "./pages/TossPaymentResult";
import CreatePage from "./pages/Create";
import EventRequestPage from "./pages/EventRequest";
import DemandPage from "./pages/Demand";
import DemandPickPage from "./pages/DemandPick";
import MyPage from "./pages/MyPage";
import AdminPage from "./pages/Admin";
import BungaetingLayout from "./components/bungaeting/BungaetingLayout";
import BungaetingHome from "./pages/bungaeting/Home";
import BungaetingOnboarding from "./pages/bungaeting/Onboarding";
import BungaetingPreferences from "./pages/bungaeting/Preferences";
import BungaetingMe from "./pages/bungaeting/Me";
import BungaetingTripDetail from "./pages/bungaeting/TripDetail";
import BungaetingProposals from "./pages/bungaeting/Proposals";

// 관리자만 데스크톱 폭 레이아웃(기존 Navbar+Footer) — 나머지 전부 폰 프레임 앱 셸.
function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 page-enter">{children}</main>
      <Footer />
    </div>
  );
}

function Router() {
  return (
    <Switch>
      {/* ── 탭 페이지 (하단 탭바 표시) ── */}
      <Route path="/">
        <AppShell><Home /></AppShell>
      </Route>
      <Route path="/events">
        <AppShell><EventsPage /></AppShell>
      </Route>
      <Route path="/demand">
        <AppShell><DemandPage /></AppShell>
      </Route>
      <Route path="/mypage">
        <AppShell><MyPage /></AppShell>
      </Route>

      {/* 개설 마법사 — 관리자 전용 (페이지 내부에서 가드) */}
      <Route path="/create">
        <AppShell><CreatePage /></AppShell>
      </Route>

      {/* ── 서브/신청 플로우 (back 헤더, 탭 숨김 — 앱의 풀스크린 플로우처럼) ── */}
      <Route path="/event-request">
        <AppShell title="이벤트 만들기" hideTabs><EventRequestPage /></AppShell>
      </Route>
      <Route path="/demand/:id">
        {(params) => (
          <AppShell title="셔틀 만들기" hideTabs>
            <DemandPickPage eventId={Number(params.id)} />
          </AppShell>
        )}
      </Route>
      <Route path="/events/:id">
        {(params) => (
          <AppShell titleKey="title.event" hideTabs>
            <EventDetailPage id={Number(params.id)} />
          </AppShell>
        )}
      </Route>
      <Route path="/trips/:tripId/book">
        {(params) => (
          <AppShell titleKey="title.booking" hideTabs>
            <BookingPage tripId={Number(params.tripId)} />
          </AppShell>
        )}
      </Route>
      <Route path="/reservations/:id/confirm">
        {(params) => (
          <AppShell titleKey="title.bookingConfirm" hideTabs>
            <BookingConfirmPage reservationId={Number(params.id)} />
          </AppShell>
        )}
      </Route>
      <Route path="/events/:id/join">
        {(params) => (
          <AppShell title="참가 신청" hideTabs>
            <RequestJoinPage eventId={Number(params.id)} />
          </AppShell>
        )}
      </Route>
      <Route path="/requests/:id/confirm">
        {(params) => (
          <AppShell title="신청 확인" hideTabs>
            <RequestJoinConfirmPage requestId={Number(params.id)} />
          </AppShell>
        )}
      </Route>
      <Route path="/payments/toss/success">
        <AppShell title="결제 완료" hideTabs><TossPaymentSuccessPage /></AppShell>
      </Route>
      <Route path="/payments/toss/fail">
        <AppShell title="결제 실패" hideTabs><TossPaymentFailPage /></AppShell>
      </Route>

      {/* ── 관리자 (유일한 데스크톱 폭 예외) ── */}
      <Route path="/admin">
        <AdminLayout><AdminPage /></AdminLayout>
      </Route>

      {/* ── 번개팅 (자체 서브 셸 — 옐로 톤 + 자체 하단 탭) ── */}
      <Route path="/bungaeting">
        <BungaetingLayout><BungaetingHome /></BungaetingLayout>
      </Route>
      <Route path="/bungaeting/onboarding">
        <BungaetingLayout><BungaetingOnboarding /></BungaetingLayout>
      </Route>
      <Route path="/bungaeting/proposals">
        <BungaetingLayout><BungaetingProposals /></BungaetingLayout>
      </Route>
      <Route path="/bungaeting/preferences">
        <BungaetingLayout><BungaetingPreferences /></BungaetingLayout>
      </Route>
      <Route path="/bungaeting/me">
        <BungaetingLayout><BungaetingMe /></BungaetingLayout>
      </Route>
      <Route path="/bungaeting/trips/:id">
        {(params) => <BungaetingLayout><BungaetingTripDetail id={Number(params.id)} /></BungaetingLayout>}
      </Route>

      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

// 공유 링크의 ?ref= 추천 코드를 세션에 보관 — 가입 귀속이 아니라 결제 화면
// 코드 입력란 프리필용 (referral-credit-spec §3.2). 결제자는 지우거나 교체 가능.
const refParam = new URLSearchParams(window.location.search).get("ref");
if (refParam && /^[A-Za-z0-9]{4,16}$/.test(refParam)) {
  try {
    sessionStorage.setItem("bungae_ref", refParam.toUpperCase());
  } catch {}
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <LocaleProvider>
          <TooltipProvider>
            <Toaster position="top-center" richColors />
            <Router />
          </TooltipProvider>
        </LocaleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
