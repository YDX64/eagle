/**
 * Layout Component - Arctic Futurism Multi-Sport Layout
 * Sol sidebar (nav + sport selector), top bar (language + theme), main content
 */
import { Link, useLocation } from "wouter";
import { useState, useEffect, useMemo } from "react";
import {
  Home,
  Ticket,
  Menu,
  X,
  Zap,
  RefreshCw,
  History,
  Settings as SettingsIcon,
  Trophy,
  Layers,
  ChevronRight,
  BarChart3,
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { useSport } from "@/contexts/SportContext";
import { getSportsList, popularSports, allSports } from "@/sports/registry";
import { getSavedCoupons } from "@/lib/couponStorage";
import LanguageSwitcher from "./LanguageSwitcher";
import type { SportId } from "@/sports/_core/types";

const SPORT_ICONS: Record<SportId, string> = {
  football: "⚽",
  basketball: "🏀",
  hockey: "🏒",
  volleyball: "🏐",
  handball: "🤾",
  nba: "🏀",
  americanFootball: "🏈",
  baseball: "⚾",
  rugby: "🏉",
  mma: "🥊",
  afl: "🏉",
  formula1: "🏎️",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [savedCouponCount, setSavedCouponCount] = useState(0);
  const [allSportsOpen, setAllSportsOpen] = useState(false);
  const { locale } = useLocale();
  const { currentSport, setCurrentSport } = useSport();

  const navLabels = useMemo(() => {
    if (locale === "tr") {
      return {
        dashboard: "Ana Panel",
        coupons: "Kupon Üretici",
        system: "Sistem Kuponu",
        history: "Kupon Geçmişi",
        settings: "Ayarlar",
        sports: "SPORLAR",
        moreSports: "Tüm Sporlar",
        systemActive: "Sistem Aktif",
      };
    }
    if (locale === "sv") {
      return {
        dashboard: "Huvudpanel",
        coupons: "Kuponggenerator",
        system: "Systemkupong",
        history: "Kuponghistorik",
        settings: "Inställningar",
        sports: "SPORTER",
        moreSports: "Alla Sporter",
        systemActive: "System Aktivt",
      };
    }
    return {
      dashboard: "Dashboard",
      coupons: "Coupon Generator",
      system: "System Coupon",
      history: "Coupon History",
      settings: "Settings",
      sports: "SPORTS",
      moreSports: "All Sports",
      systemActive: "System Active",
    };
  }, [locale]);

  const NAV_ITEMS = [
    { path: "/", label: navLabels.dashboard, icon: Home },
    { path: "/coupons", label: navLabels.coupons, icon: Ticket },
    { path: "/system-coupons", label: navLabels.system, icon: Layers },
    { path: "/coupon-history", label: navLabels.history, icon: History },
    { path: "/settings", label: navLabels.settings, icon: SettingsIcon },
  ];

  useEffect(() => {
    setSavedCouponCount(getSavedCoupons().length);
    const handler = () => setSavedCouponCount(getSavedCoupons().length);
    window.addEventListener("storage", handler);
    const interval = setInterval(() => setSavedCouponCount(getSavedCoupons().length), 5000);
    return () => {
      window.removeEventListener("storage", handler);
      clearInterval(interval);
    };
  }, []);

  const dateLocale = locale === "tr" ? "tr-TR" : locale === "sv" ? "sv-SE" : "en-GB";
  const sports = getSportsList();

  const handleSportClick = (id: SportId) => {
    setCurrentSport(id);
    setLocation(`/sport/${id}`);
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-background flex">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-72 flex flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="p-5 border-b border-sidebar-border">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-ice to-aurora flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-background" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold tracking-wider neon-text">
                ALL SPORTS
              </h1>
              <p className="text-[10px] text-muted-foreground tracking-widest uppercase">
                Analytics Platform
              </p>
            </div>
          </Link>
        </div>

        <div className="overflow-y-auto flex-1 scrollbar-thin">
          <nav className="p-4 space-y-1">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.path === "/"
                  ? location === "/"
                  : location === item.path || location.startsWith(item.path + "/");
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
                  <Icon className="w-4 h-4" />
                  {item.label}
                  {item.path === "/coupon-history" && savedCouponCount > 0 && (
                    <span className="ml-auto text-[10px] bg-ice/20 text-ice px-1.5 py-0.5 rounded-full font-mono">
                      {savedCouponCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="px-4 pt-2 pb-4 border-t border-sidebar-border/60">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-muted-foreground tracking-widest uppercase font-semibold">
                {navLabels.sports}
              </p>
              <button
                onClick={() => setAllSportsOpen((x) => !x)}
                className="text-[10px] text-muted-foreground hover:text-ice flex items-center gap-1"
              >
                {allSportsOpen ? "−" : "+"} {navLabels.moreSports}
              </button>
            </div>

            <div className="space-y-1">
              {(allSportsOpen ? allSports : popularSports).map((plugin) => {
                const id = plugin.config.id;
                const isActive = currentSport === id && location.startsWith("/sport/");
                const name = locale === "tr" ? plugin.config.displayNameTR : plugin.config.displayName;
                return (
                  <button
                    key={id}
                    onClick={() => handleSportClick(id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? "bg-ice/20 text-ice border border-ice/40"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    }`}
                  >
                    <span className="text-base leading-none">{SPORT_ICONS[id]}</span>
                    <span className="flex-1 text-left">{name}</span>
                    {isActive && <ChevronRight className="w-3 h-3" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <RefreshCw className="w-3 h-3" />
            <span>
              {new Date().toLocaleDateString(dateLocale, {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
            <Zap className="w-3 h-3 text-aurora" />
            <span>awastats.com</span>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-14 border-b border-border bg-background/80 backdrop-blur-xl flex items-center px-4 gap-4">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 rounded-lg hover:bg-accent"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="hidden md:flex items-center gap-2 overflow-x-auto scrollbar-thin">
            {popularSports.slice(0, 6).map((plugin) => {
              const id = plugin.config.id;
              const isActive = currentSport === id && location.startsWith("/sport/");
              return (
                <button
                  key={id}
                  onClick={() => handleSportClick(id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                    isActive
                      ? "bg-ice/20 text-ice border border-ice/40"
                      : "bg-accent/30 text-muted-foreground hover:bg-accent/50 border border-transparent"
                  }`}
                >
                  <span>{SPORT_ICONS[id]}</span>
                  <span>
                    {locale === "tr" ? plugin.config.displayNameTR : plugin.config.displayName}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <LanguageSwitcher />
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/50">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-aurora opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-aurora" />
              </span>
              <span className="font-mono">{navLabels.systemActive}</span>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-auto scrollbar-thin">
          {children}
        </main>
      </div>
    </div>
  );
}
