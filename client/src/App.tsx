import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
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
import MyPage from "./pages/MyPage";
import AdminPage from "./pages/Admin";
import BungaetingLayout from "./components/bungaeting/BungaetingLayout";
import BungaetingHome from "./pages/bungaeting/Home";
import BungaetingOnboarding from "./pages/bungaeting/Onboarding";
import BungaetingPreferences from "./pages/bungaeting/Preferences";
import BungaetingMe from "./pages/bungaeting/Me";
import BungaetingTripDetail from "./pages/bungaeting/TripDetail";
import BungaetingProposals from "./pages/bungaeting/Proposals";

function Layout({ children }: { children: React.ReactNode }) {
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
      <Route path="/" component={Home} />
      <Route path="/events">
        <Layout><EventsPage /></Layout>
      </Route>
      <Route path="/events/:id">
        {(params) => <Layout><EventDetailPage id={Number(params.id)} /></Layout>}
      </Route>
      <Route path="/trips/:tripId/book">
        {(params) => <Layout><BookingPage tripId={Number(params.tripId)} /></Layout>}
      </Route>
      <Route path="/reservations/:id/confirm">
        {(params) => <Layout><BookingConfirmPage reservationId={Number(params.id)} /></Layout>}
      </Route>
      <Route path="/events/:id/join">
        {(params) => <Layout><RequestJoinPage eventId={Number(params.id)} /></Layout>}
      </Route>
      <Route path="/requests/:id/confirm">
        {(params) => <Layout><RequestJoinConfirmPage requestId={Number(params.id)} /></Layout>}
      </Route>
      <Route path="/payments/toss/success">
        <Layout><TossPaymentSuccessPage /></Layout>
      </Route>
      <Route path="/payments/toss/fail">
        <Layout><TossPaymentFailPage /></Layout>
      </Route>
      <Route path="/create">
        <Layout><CreatePage /></Layout>
      </Route>
      <Route path="/mypage">
        <Layout><MyPage /></Layout>
      </Route>
      <Route path="/admin">
        <Layout><AdminPage /></Layout>
      </Route>
      {/* 번개팅(동행·친목) — 옐로 톤 서브 레이아웃 + 하단 탭. 회차/제안은 이후 단계. */}
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

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster position="top-center" richColors />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
