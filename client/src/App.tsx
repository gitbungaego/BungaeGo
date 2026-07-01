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
import CreatePage from "./pages/Create";
import MyPage from "./pages/MyPage";
import AdminPage from "./pages/Admin";

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
      <Route path="/create">
        <Layout><CreatePage /></Layout>
      </Route>
      <Route path="/mypage">
        <Layout><MyPage /></Layout>
      </Route>
      <Route path="/admin">
        <Layout><AdminPage /></Layout>
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
