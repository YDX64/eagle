/**
 * All Sports App - Mount wrapper for ProBet integration
 * 
 * Wraps the multi-sport SPA with wouter base="/all-sports" so all internal
 * routing works under ProBet's path structure (pro.awastats.com/all-sports/*).
 */
'use client';

import { Router as WouterRouter, Route, Switch } from 'wouter';
import { useBrowserLocation } from 'wouter/use-browser-location';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { LocaleProvider } from '@/components/all-sports/contexts/LocaleContext';
import { SportProvider } from '@/components/all-sports/contexts/SportContext';
import Dashboard from '@/components/all-sports/pages/Dashboard';
import SportHome from '@/components/all-sports/pages/SportHome';
import MatchDetail from '@/components/all-sports/pages/MatchDetail';
import Coupons from '@/components/all-sports/pages/Coupons';
import CouponHistory from '@/components/all-sports/pages/CouponHistory';
import SystemCoupons from '@/components/all-sports/pages/SystemCoupons';
import Settings from '@/components/all-sports/pages/Settings';
import NotFound from '@/components/all-sports/pages/NotFound';
import Layout from '@/components/all-sports/Layout';

// Custom hook to use wouter with base path
function useBase() {
  return useBrowserLocation();
}

export default function AllSportsApp() {
  return (
    <LocaleProvider>
      <SportProvider>
        <TooltipProvider>
          <WouterRouter base="/all-sports">
            <Layout>
              <Switch>
                <Route path="/" component={Dashboard} />
                <Route path="/sport/:sportId" component={SportHome} />
                <Route path="/match/:sportId/:id" component={MatchDetail} />
                <Route path="/coupons" component={Coupons} />
                <Route path="/coupon-history" component={CouponHistory} />
                <Route path="/system-coupons" component={SystemCoupons} />
                <Route path="/settings" component={Settings} />
                <Route component={NotFound} />
              </Switch>
            </Layout>
          </WouterRouter>
          <Toaster position="top-right" />
        </TooltipProvider>
      </SportProvider>
    </LocaleProvider>
  );
}
