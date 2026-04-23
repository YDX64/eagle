import { Toaster } from "@/components/all-sports/ui/sonner";
import { TooltipProvider } from "@/components/all-sports/ui/tooltip";
import NotFound from "@/components/all-sports/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LocaleProvider } from "./contexts/LocaleContext";
import { SportProvider } from "./contexts/SportContext";
import Dashboard from "./pages/Dashboard";
import SportHome from "./pages/SportHome";
import MatchDetail from "./pages/MatchDetail";
import Coupons from "./pages/Coupons";
import CouponHistory from "./pages/CouponHistory";
import SystemCoupons from "./pages/SystemCoupons";
import Settings from "./pages/Settings";
import Layout from "./components/Layout";

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/sport/:sportId" component={SportHome} />
        <Route path="/match/:sportId/:id" component={MatchDetail} />
        <Route path="/coupons" component={Coupons} />
        <Route path="/coupon-history" component={CouponHistory} />
        <Route path="/system-coupons" component={SystemCoupons} />
        <Route path="/settings" component={Settings} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <LocaleProvider>
          <SportProvider>
            <TooltipProvider>
              <Toaster />
              <Router />
            </TooltipProvider>
          </SportProvider>
        </LocaleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
