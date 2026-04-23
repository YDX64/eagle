/**
 * Settings - Filter defaults and preferences
 * Saves to localStorage
 */
import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import {
  Save,
  RotateCcw,
  Database,
  Check,
  Settings as SettingsIcon,
  ArrowLeft,
  Sun,
  Moon,
  Globe,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/components/all-sports/contexts/LocaleContext";
import { useTheme } from "@/components/all-sports/contexts/ThemeContext";
import { allSports } from "@/lib/all-sports/sports/registry";
import { DEFAULT_FILTERS } from "@/lib/all-sports/couponEngine";
import { LOCALES, type Locale } from "@/lib/all-sports/i18n";
import type { CouponFilterConfig, SportId } from "@/lib/all-sports/sports/_core/types";

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

const FILTER_KEY = "asa_coupon_filter_config";
const SETTINGS_KEY = "asa_user_settings";

interface UserSettings {
  defaultFilters: CouponFilterConfig;
}

function loadSettings(): UserSettings {
  try {
    const filterData = localStorage.getItem(FILTER_KEY);
    const settings = localStorage.getItem(SETTINGS_KEY);
    if (settings) {
      return JSON.parse(settings);
    }
    if (filterData) {
      return { defaultFilters: { ...DEFAULT_FILTERS, ...JSON.parse(filterData) } };
    }
  } catch {}
  return { defaultFilters: { ...DEFAULT_FILTERS } };
}

function saveSettings(s: UserSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    localStorage.setItem(FILTER_KEY, JSON.stringify(s.defaultFilters));
  } catch {}
}

export default function Settings() {
  const { locale, setLocale } = useLocale();
  const { theme, toggleTheme } = useTheme();
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings());
  const [dirty, setDirty] = useState(false);

  const labels = useMemo(() => {
    if (locale === "tr") {
      return {
        back: "Ana Panele Dön",
        title: "AYARLAR",
        subtitle: "Filtre varsayılanları ve tercihler",
        appearance: "Görünüm",
        theme: "Tema",
        light: "Açık",
        dark: "Koyu",
        language: "Dil",
        defaultFilters: "Varsayılan Filtreler",
        defaultsDesc:
          "Kupon üretici ve sistem kupon sayfalarında kullanılan varsayılan değerler",
        minOdds: "Min Oran",
        maxOdds: "Max Oran",
        minProb: "Min Olasılık",
        minEdge: "Min Edge (Avantaj)",
        allowDraws: "Berabere Bahisleri İzin Ver",
        minBets: "Min Bahis Sayısı",
        maxBets: "Max Bahis Sayısı",
        enabledSports: "Etkin Sporlar",
        selectAll: "Hepsini Seç",
        clearAll: "Temizle",
        dataManagement: "Veri Yönetimi",
        clearCache: "Önbelleği Temizle",
        clearCacheDesc: "Tüm kaydedilen filtre ayarlarını sıfırlar",
        clearCoupons: "Tüm Kuponları Sil",
        clearCouponsDesc: "Kaydedilen tüm kuponları kalıcı olarak siler. Geri alınamaz.",
        clearConfirm: "Tüm kaydedilen kuponları silmek istediğinize emin misiniz?",
        cacheCleared: "Önbellek temizlendi",
        couponsCleared: "Tüm kuponlar silindi",
        save: "Kaydet",
        saved: "Ayarlar kaydedildi",
        reset: "Varsayılanlara Dön",
        unit: "%",
      };
    }
    if (locale === "sv") {
      return {
        back: "Tillbaka till Dashboard",
        title: "INSTÄLLNINGAR",
        subtitle: "Filter-standardvärden och preferenser",
        appearance: "Utseende",
        theme: "Tema",
        light: "Ljust",
        dark: "Mörkt",
        language: "Språk",
        defaultFilters: "Standardfilter",
        defaultsDesc: "Standardvärden för kupong- och systemkupong-sidor",
        minOdds: "Min Odds",
        maxOdds: "Max Odds",
        minProb: "Min Sannolikhet",
        minEdge: "Min Edge",
        allowDraws: "Tillåt Oavgjort",
        minBets: "Min Spel",
        maxBets: "Max Spel",
        enabledSports: "Aktiverade Sporter",
        selectAll: "Välj Alla",
        clearAll: "Rensa",
        dataManagement: "Datahantering",
        clearCache: "Rensa Cache",
        clearCacheDesc: "Återställer alla sparade filterinställningar",
        clearCoupons: "Radera Alla Kuponger",
        clearCouponsDesc: "Raderar alla sparade kuponger permanent.",
        clearConfirm: "Är du säker på att du vill radera alla kuponger?",
        cacheCleared: "Cache rensad",
        couponsCleared: "Alla kuponger raderade",
        save: "Spara",
        saved: "Inställningar sparade",
        reset: "Återställ standard",
        unit: "%",
      };
    }
    return {
      back: "Back to Dashboard",
      title: "SETTINGS",
      subtitle: "Filter defaults and preferences",
      appearance: "Appearance",
      theme: "Theme",
      light: "Light",
      dark: "Dark",
      language: "Language",
      defaultFilters: "Default Filters",
      defaultsDesc: "Default values used in Coupon Generator and System Coupon pages",
      minOdds: "Min Odds",
      maxOdds: "Max Odds",
      minProb: "Min Probability",
      minEdge: "Min Edge",
      allowDraws: "Allow Draw Bets",
      minBets: "Min Bets",
      maxBets: "Max Bets",
      enabledSports: "Enabled Sports",
      selectAll: "Select All",
      clearAll: "Clear All",
      dataManagement: "Data Management",
      clearCache: "Clear Cache",
      clearCacheDesc: "Resets all saved filter settings",
      clearCoupons: "Delete All Coupons",
      clearCouponsDesc: "Permanently deletes all saved coupons.",
      clearConfirm: "Are you sure you want to delete all saved coupons?",
      cacheCleared: "Cache cleared",
      couponsCleared: "All coupons deleted",
      save: "Save",
      saved: "Settings saved",
      reset: "Reset defaults",
      unit: "%",
    };
  }, [locale]);

  const update = <K extends keyof CouponFilterConfig>(
    key: K,
    value: CouponFilterConfig[K]
  ) => {
    setSettings((s) => ({ ...s, defaultFilters: { ...s.defaultFilters, [key]: value } }));
    setDirty(true);
  };

  const saveAll = () => {
    saveSettings(settings);
    setDirty(false);
    toast.success(labels.saved);
  };

  const resetToDefaults = () => {
    setSettings({ defaultFilters: { ...DEFAULT_FILTERS } });
    setDirty(true);
  };

  const clearCache = () => {
    localStorage.removeItem(FILTER_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    setSettings({ defaultFilters: { ...DEFAULT_FILTERS } });
    setDirty(false);
    toast.success(labels.cacheCleared);
  };

  const clearAllCoupons = () => {
    if (!confirm(labels.clearConfirm)) return;
    localStorage.removeItem("all_sports_coupons_v1");
    toast.success(labels.couponsCleared);
  };

  const toggleSport = (id: SportId) => {
    setSettings((s) => {
      const has = s.defaultFilters.allowedSports.includes(id);
      return {
        ...s,
        defaultFilters: {
          ...s.defaultFilters,
          allowedSports: has
            ? s.defaultFilters.allowedSports.filter((x) => x !== id)
            : [...s.defaultFilters.allowedSports, id],
        },
      };
    });
    setDirty(true);
  };

  return (
    <div className="space-y-5">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> {labels.back}
      </Link>

      <div className="glass-card rounded-xl p-6 border border-ice/20">
        <h1 className="font-display text-2xl sm:text-4xl font-black neon-text tracking-wider flex items-center gap-3">
          <SettingsIcon className="w-8 h-8" />
          {labels.title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{labels.subtitle}</p>
      </div>

      {/* Appearance */}
      <div className="glass-card rounded-xl p-5">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-ice" /> {labels.appearance}
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2 block">
              {labels.theme}
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (theme === "dark" && toggleTheme) toggleTheme();
                }}
                className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                  theme === "light"
                    ? "bg-ice/20 border-ice/40 text-ice border"
                    : "bg-accent/30 border border-border text-muted-foreground"
                }`}
              >
                <Sun className="w-4 h-4" /> {labels.light}
              </button>
              <button
                onClick={() => {
                  if (theme === "light" && toggleTheme) toggleTheme();
                }}
                className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                  theme === "dark"
                    ? "bg-ice/20 border-ice/40 text-ice border"
                    : "bg-accent/30 border border-border text-muted-foreground"
                }`}
              >
                <Moon className="w-4 h-4" /> {labels.dark}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2 block">
              <Globe className="w-3 h-3 inline mr-1" /> {labels.language}
            </label>
            <div className="flex gap-2">
              {LOCALES.map((loc) => (
                <button
                  key={loc.code}
                  onClick={() => setLocale(loc.code as Locale)}
                  className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                    locale === loc.code
                      ? "bg-ice/20 border-ice/40 text-ice border"
                      : "bg-accent/30 border border-border text-muted-foreground"
                  }`}
                >
                  <img src={loc.flagUrl} alt="" className="w-4 h-3" />
                  {loc.nativeName}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Default filters */}
      <div className="glass-card rounded-xl p-5">
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-aurora" /> {labels.defaultFilters}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">{labels.defaultsDesc}</p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <SliderField
            label={labels.minOdds}
            value={settings.defaultFilters.minOdds}
            min={1.01}
            max={5}
            step={0.05}
            color="text-ice"
            displayFormat={(v) => v.toFixed(2)}
            onChange={(v) => update("minOdds", v)}
          />
          <SliderField
            label={labels.minProb}
            value={settings.defaultFilters.minProbability}
            min={50}
            max={99}
            step={1}
            color="text-aurora"
            displayFormat={(v) => `${v}%`}
            onChange={(v) => update("minProbability", v)}
          />
          <SliderField
            label={labels.minEdge}
            value={settings.defaultFilters.minEdge}
            min={0}
            max={30}
            step={1}
            color="text-warning"
            displayFormat={(v) => `${v}%`}
            onChange={(v) => update("minEdge", v)}
          />
          <SliderField
            label={labels.minBets}
            value={settings.defaultFilters.minBetsPerCoupon}
            min={2}
            max={8}
            step={1}
            color="text-ice"
            displayFormat={(v) => v.toString()}
            onChange={(v) => update("minBetsPerCoupon", v)}
          />
          <SliderField
            label={labels.maxBets}
            value={settings.defaultFilters.maxBetsPerCoupon}
            min={2}
            max={12}
            step={1}
            color="text-aurora"
            displayFormat={(v) => v.toString()}
            onChange={(v) => update("maxBetsPerCoupon", v)}
          />
          <div className="flex items-end">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.defaultFilters.allowDraws}
                onChange={(e) => update("allowDraws", e.target.checked)}
                className="w-4 h-4 rounded border-border accent-ice"
              />
              <span className="text-sm">{labels.allowDraws}</span>
            </label>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border/30">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              {labels.enabledSports}
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSettings((s) => ({
                    ...s,
                    defaultFilters: {
                      ...s.defaultFilters,
                      allowedSports: allSports.map((x) => x.config.id),
                    },
                  }));
                  setDirty(true);
                }}
                className="text-[10px] text-ice hover:underline"
              >
                {labels.selectAll}
              </button>
              <button
                onClick={() => {
                  setSettings((s) => ({
                    ...s,
                    defaultFilters: { ...s.defaultFilters, allowedSports: [] },
                  }));
                  setDirty(true);
                }}
                className="text-[10px] text-destructive hover:underline"
              >
                {labels.clearAll}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {allSports.map((s) => {
              const id = s.config.id;
              const active = settings.defaultFilters.allowedSports.includes(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleSport(id)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs transition-all ${
                    active
                      ? "bg-ice/20 border-ice/40 text-ice"
                      : "bg-accent/30 border-border text-muted-foreground"
                  }`}
                >
                  <span>{SPORT_ICONS[id]}</span>
                  <span className="truncate">
                    {locale === "tr" ? s.config.displayNameTR : s.config.displayName}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex gap-3 flex-wrap">
          <button
            onClick={saveAll}
            disabled={!dirty}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-ice text-background hover:bg-ice/90 disabled:opacity-50 disabled:cursor-default transition-all"
          >
            {dirty ? <Save className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            {dirty ? labels.save : labels.saved}
          </button>
          <button
            onClick={resetToDefaults}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-accent/40 border border-border hover:bg-accent/60 transition-all"
          >
            <RotateCcw className="w-4 h-4" /> {labels.reset}
          </button>
        </div>
      </div>

      {/* Data management */}
      <div className="glass-card rounded-xl p-5 border border-destructive/30">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2 text-destructive">
          <Database className="w-4 h-4" /> {labels.dataManagement}
        </h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold">{labels.clearCache}</p>
              <p className="text-xs text-muted-foreground">{labels.clearCacheDesc}</p>
            </div>
            <button
              onClick={clearCache}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-warning/20 text-warning border border-warning/40 hover:bg-warning/30 transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" /> {labels.clearCache}
            </button>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap pt-3 border-t border-border/30">
            <div>
              <p className="text-sm font-semibold">{labels.clearCoupons}</p>
              <p className="text-xs text-muted-foreground">{labels.clearCouponsDesc}</p>
            </div>
            <button
              onClick={clearAllCoupons}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-destructive/20 text-destructive border border-destructive/40 hover:bg-destructive/30 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" /> {labels.clearCoupons}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  color,
  displayFormat,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  color: string;
  displayFormat: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
        {label}:{" "}
        <span className={`font-mono font-bold ${color}`}>{displayFormat(value)}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`w-full mt-2 ${
          color === "text-ice"
            ? "accent-ice"
            : color === "text-aurora"
            ? "accent-aurora"
            : "accent-warning"
        }`}
      />
    </div>
  );
}
