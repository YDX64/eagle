/**
 * Layout Component - Arctic Futurism Theme
 * Sol sidebar navigasyon, üst bar, dil seçici ve ana içerik alanı
 */
import { Link, useLocation } from "wouter";
import { useState, useEffect } from "react";
import {
  Home,
  Trophy,
  BarChart3,
  Ticket,
  Menu,
  X,
  Zap,
  RefreshCw,
  History,
} from "lucide-react";
import { getLiveGames } from "@/lib/api";
import { getSavedCoupons } from "@/lib/couponStore";
import { useLocale } from "@/contexts/LocaleContext";
import LanguageSwitcher from "./LanguageSwitcher";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [savedCouponCount, setSavedCouponCount] = useState(0);
  const { locale, t } = useLocale();

  const NAV_ITEMS = [
    { path: "/", label: t('nav_daily_matches'), icon: Home },
    { path: "/standings", label: t('nav_standings'), icon: Trophy },
    { path: "/coupons", label: t('nav_coupons'), icon: Ticket },
    { path: "/coupon-history", label: t('nav_coupon_history'), icon: History },
  ];

  const liveLabel = locale === 'tr' ? 'Canlı Maç' : locale === 'sv' ? 'Live Matcher' : 'Live Matches';
  const liveTag = locale === 'tr' ? 'CANLI' : 'LIVE';

  useEffect(() => {
    const checkLive = async () => {
      try {
        const res = await getLiveGames();
        setLiveCount(res.results);
        setLastUpdate(new Date());
      } catch { /* ignore */ }
    };
    checkLive();
    const interval = setInterval(checkLive, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setSavedCouponCount(getSavedCoupons().length);
    const handleStorage = () => setSavedCouponCount(getSavedCoupons().length);
    window.addEventListener('storage', handleStorage);
    const interval = setInterval(() => setSavedCouponCount(getSavedCoupons().length), 5000);
    return () => { window.removeEventListener('storage', handleStorage); clearInterval(interval); };
  }, []);

  const dateLocale = locale === 'tr' ? 'tr-TR' : locale === 'sv' ? 'sv-SE' : 'en-GB';

  return (
    <div className="min-h-screen bg-background flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-64 flex flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Logo */}
        <div className="p-5 border-b border-sidebar-border">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-ice to-aurora flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-background" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold tracking-wider neon-text">
                AWA STATS
              </h1>
              <p className="text-[10px] text-muted-foreground tracking-widest uppercase">
                awastats.com
              </p>
            </div>
          </Link>
        </div>

        {/* Live indicator */}
        {liveCount > 0 && (
          <div className="mx-4 mt-4 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
              </span>
              <span className="text-xs font-medium text-destructive">
                {liveCount} {liveLabel}
              </span>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.path;
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                href={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary neon-border"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="w-4.5 h-4.5" />
                {item.label}
                {item.path === "/" && liveCount > 0 && (
                  <span className="ml-auto text-[10px] bg-destructive text-destructive-foreground px-1.5 py-0.5 rounded-full">
                    {liveTag}
                  </span>
                )}
                {item.path === "/coupon-history" && savedCouponCount > 0 && (
                  <span className="ml-auto text-[10px] bg-ice/20 text-ice px-1.5 py-0.5 rounded-full font-mono">
                    {savedCouponCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <RefreshCw className="w-3 h-3" />
            <span>
              {t('home_last_update')}:{" "}
              {lastUpdate.toLocaleTimeString(dateLocale, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
            <Zap className="w-3 h-3 text-aurora" />
            <span>awastats.com</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 h-14 border-b border-border bg-background/80 backdrop-blur-xl flex items-center px-4 gap-4">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 rounded-lg hover:bg-accent"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="flex-1" />

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {/* Language Switcher */}
            <LanguageSwitcher />

            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/50">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-aurora opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-aurora" />
              </span>
              <span className="font-mono">{t('nav_system_active')}</span>
            </div>
            <span className="font-mono hidden md:inline">
              {new Date().toLocaleDateString(dateLocale, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto scrollbar-thin">
          {children}
        </main>
      </div>
    </div>
  );
}
