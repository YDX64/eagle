/**
 * Coupons - Multi-Sport Coupon Generator
 * Arctic Futurism UI, Turkish default
 *
 * - Date picker (default today)
 * - Filter panel: min odds, min probability, min edge, sports checkboxes
 * - Analysis button -> analyzeMultiSport
 * - Strategies grid (Safe, Value, High Odds, System 3/5 & 4/5, Multi-sport)
 * - Save per strategy + individual value bets
 */
import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import {
  Loader2,
  Ticket,
  Shield,
  Target,
  Zap,
  Filter,
  ChevronRight,
  Save,
  Layers,
  AlertTriangle,
  CheckCircle2,
  BookmarkPlus,
  Calendar,
  RefreshCw,
  History,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { allSports, popularSports, getSport } from "@/lib/all-sports/sports/registry";
import { useLocale } from "@/components/all-sports/contexts/LocaleContext";
import {
  analyzeMultiSport,
  generateCouponStrategies,
  DEFAULT_FILTERS,
  type CouponStrategy,
} from "@/lib/all-sports/couponEngine";
import { saveCoupon } from "@/lib/all-sports/couponStorage";
import type {
  SportId,
  ValueBet,
  CouponFilterConfig,
  CouponBet,
} from "@/lib/all-sports/sports/_core/types";

const HERO_BG =
  "https://d2xsxph8kpxj0f.cloudfront.net/113104593/XD6sTiRUS9vW5Ribu2FZ4U/hero-banner-cAvoYmzafSTHSonnd88HXv.webp";

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

const STORAGE_KEY = "asa_coupon_filter_config";

function loadFilterConfig(): CouponFilterConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_FILTERS, ...parsed };
    }
  } catch {}
  return { ...DEFAULT_FILTERS };
}

function saveFilterConfig(f: CouponFilterConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {}
}

export default function Coupons() {
  const { locale } = useLocale();
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [filters, setFilters] = useState<CouponFilterConfig>(loadFilterConfig());
  const [showFilters, setShowFilters] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [valueBets, setValueBets] = useState<ValueBet[]>([]);
  const [strategies, setStrategies] = useState<CouponStrategy[]>([]);
  const [errors, setErrors] = useState<{ sport: SportId; error: string }[]>([]);
  const [savedStrategies, setSavedStrategies] = useState<Set<string>>(new Set());

  const labels = useMemo(() => {
    if (locale === "tr") {
      return {
        title: "KUPON ÜRETİCİ",
        subtitle: "12 farklı sporda değer bahisleri bulan çoklu-spor motor",
        today: "Bugün",
        date: "Tarih",
        filters: "Filtreler",
        showFilters: "Filtreleri Göster",
        hideFilters: "Filtreleri Gizle",
        minOdds: "Min Oran",
        minProb: "Min Olasılık",
        minEdge: "Min Edge (Avantaj)",
        sports: "Sporlar",
        selectAll: "Hepsini Seç",
        clearAll: "Temizle",
        startAnalysis: "Analizi Başlat",
        analyzing: "Analiz ediliyor",
        strategies: "ÖNERİLEN KUPON STRATEJİLERİ",
        noStrategies: "Bu filtre ayarlarıyla strateji oluşturulamadı",
        noStrategiesDesc: "Filtreleri gevşetin veya başka bir tarih deneyin",
        systemCoupon: "Sistem Kuponu",
        totalOdds: "Toplam Oran",
        expectedProb: "Beklenen Olasılık",
        expectedValue: "Beklenen Değer",
        suggestedStake: "Önerilen Yatırım",
        potentialReturn: "Potansiyel Kazanç",
        unit: "birim",
        save: "Kaydet",
        saved: "Kaydedildi",
        bets: "bahis",
        valueBets: "BULUNAN DEĞER BAHİSLER",
        valueBetsCount: "değer bahis",
        edge: "Edge",
        odds: "Oran",
        prob: "Olasılık",
        saveAsSingle: "Tek Bahis Kaydet",
        quickSystem: "HIZLI SİSTEM KUPONU",
        quickSystemDesc: "3/5 veya 4/5 sistem: 5 bahisten N'i tutması yeterli",
        goToSystem: "Sistem Kupon Sayfası",
        errorTitle: "Uyarı",
        errorsFound: "analiz sırasında hata oluştu",
        disclaimer: "Sorumluluk Reddi",
        disclaimerText:
          "Bu tahminler istatistiksel modellere dayanmaktadır ve kesin sonuç garantisi vermez. Kaybetmeyi göze alabileceğiniz miktardan fazlasını yatırmayın.",
        history: "Geçmiş",
        risk: {
          low: "Düşük Risk",
          medium: "Orta Risk",
          high: "Yüksek Risk",
          "very-high": "Çok Yüksek Risk",
        },
        resetFilters: "Varsayılanlara Dön",
      };
    }
    if (locale === "sv") {
      return {
        title: "KUPONGGENERATOR",
        subtitle: "Multi-sport värde-satsningsmotor",
        today: "Idag",
        date: "Datum",
        filters: "Filter",
        showFilters: "Visa Filter",
        hideFilters: "Dölj Filter",
        minOdds: "Min Odds",
        minProb: "Min Sannolikhet",
        minEdge: "Min Edge",
        sports: "Sporter",
        selectAll: "Välj Alla",
        clearAll: "Rensa",
        startAnalysis: "Starta Analys",
        analyzing: "Analyserar",
        strategies: "REKOMMENDERADE KUPONGSTRATEGIER",
        noStrategies: "Inga strategier kunde skapas",
        noStrategiesDesc: "Släpp på filtren eller prova ett annat datum",
        systemCoupon: "Systemkupong",
        totalOdds: "Totala Odds",
        expectedProb: "Förväntad Sannolikhet",
        expectedValue: "Förväntat Värde",
        suggestedStake: "Föreslagen Insats",
        potentialReturn: "Potentiell Vinst",
        unit: "enhet",
        save: "Spara",
        saved: "Sparad",
        bets: "spel",
        valueBets: "HITTADE VÄRDE-SATSNINGAR",
        valueBetsCount: "värde-satsningar",
        edge: "Edge",
        odds: "Odds",
        prob: "Sannolikhet",
        saveAsSingle: "Spara Enskilt",
        quickSystem: "SNABB SYSTEMKUPONG",
        quickSystemDesc: "3/5 eller 4/5 system",
        goToSystem: "Systemkupong-sida",
        errorTitle: "Varning",
        errorsFound: "fel uppstod under analys",
        disclaimer: "Ansvarsfriskrivning",
        disclaimerText:
          "Dessa prognoser är statistiska modeller, inte garantier. Satsa aldrig mer än du har råd att förlora.",
        history: "Historik",
        risk: {
          low: "Låg Risk",
          medium: "Medel Risk",
          high: "Hög Risk",
          "very-high": "Mycket Hög",
        },
        resetFilters: "Återställ",
      };
    }
    return {
      title: "COUPON GENERATOR",
      subtitle: "Multi-sport value betting engine",
      today: "Today",
      date: "Date",
      filters: "Filters",
      showFilters: "Show Filters",
      hideFilters: "Hide Filters",
      minOdds: "Min Odds",
      minProb: "Min Probability",
      minEdge: "Min Edge",
      sports: "Sports",
      selectAll: "Select All",
      clearAll: "Clear All",
      startAnalysis: "Start Analysis",
      analyzing: "Analyzing",
      strategies: "RECOMMENDED COUPON STRATEGIES",
      noStrategies: "No strategies could be created",
      noStrategiesDesc: "Relax filters or try a different date",
      systemCoupon: "System Coupon",
      totalOdds: "Total Odds",
      expectedProb: "Expected Probability",
      expectedValue: "Expected Value",
      suggestedStake: "Suggested Stake",
      potentialReturn: "Potential Return",
      unit: "units",
      save: "Save",
      saved: "Saved",
      bets: "bets",
      valueBets: "VALUE BETS FOUND",
      valueBetsCount: "value bets",
      edge: "Edge",
      odds: "Odds",
      prob: "Probability",
      saveAsSingle: "Save as Single",
      quickSystem: "QUICK SYSTEM COUPON",
      quickSystemDesc: "3/5 or 4/5 system bets",
      goToSystem: "System Coupon Page",
      errorTitle: "Warning",
      errorsFound: "errors occurred during analysis",
      disclaimer: "Disclaimer",
      disclaimerText:
        "These predictions are statistical models, not guarantees. Never bet more than you can afford to lose.",
      history: "History",
      risk: {
        low: "Low Risk",
        medium: "Medium Risk",
        high: "High Risk",
        "very-high": "Very High",
      },
      resetFilters: "Reset",
    };
  }, [locale]);

  useEffect(() => {
    saveFilterConfig(filters);
  }, [filters]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setValueBets([]);
    setStrategies([]);
    setErrors([]);
    setProgress(0);
    setProgressText("");

    const sportsToRun = allSports.filter((s) =>
      filters.allowedSports.includes(s.config.id)
    );
    const totalExpected = sportsToRun.length;

    try {
      const result = await analyzeMultiSport({
        sports: sportsToRun,
        date,
        filters,
        onProgress: (sportId, done, total) => {
          setProgressText(`${sportId}: ${done}/${total}`);
          // Rough progress based on sports already processed
          const doneSports = sportsToRun.findIndex((s) => s.config.id === sportId) + 1;
          setProgress(Math.min(95, Math.round((doneSports / totalExpected) * 90)));
        },
      });
      setValueBets(result.valueBets);
      setErrors(result.errors);
      setProgressText(labels.analyzing);
      const generated = generateCouponStrategies(result.valueBets, filters);
      setStrategies(generated);
      setProgress(100);
      toast.success(
        `${result.valueBets.length} ${labels.valueBetsCount}, ${generated.length} ${locale === "tr" ? "strateji" : "strategies"}`
      );
    } catch (err: any) {
      toast.error(err.message || "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleSport = (id: SportId) => {
    setFilters((f) => {
      const has = f.allowedSports.includes(id);
      return {
        ...f,
        allowedSports: has
          ? f.allowedSports.filter((s) => s !== id)
          : [...f.allowedSports, id],
      };
    });
  };

  const saveStrategy = (strategy: CouponStrategy, key: string) => {
    if (savedStrategies.has(key)) {
      toast.info(labels.saved);
      return;
    }
    // Enrich bets with league info from value bets
    const enrichedBets: CouponBet[] = strategy.bets.map((b) => {
      const vb = valueBets.find(
        (v) => v.gameId === b.gameId && v.betType === b.betType && v.selection === b.selection
      );
      const plugin = (() => {
        try {
          return getSport(b.sport);
        } catch {
          return null;
        }
      })();
      return {
        ...b,
        sportDisplay:
          plugin
            ? locale === "tr"
              ? plugin.config.displayNameTR
              : plugin.config.displayName
            : b.sport,
        league: b.league || "",
      };
    });
    saveCoupon({
      name: strategy.name,
      strategyName: strategy.name,
      totalOdds: strategy.totalOdds,
      stake: strategy.suggestedStake,
      potentialReturn: strategy.potentialReturn,
      riskLevel: strategy.riskLevel,
      bets: enrichedBets,
    });
    setSavedStrategies((prev) => new Set(prev).add(key));
    toast.success(`${strategy.name} ${labels.saved}`);
  };

  const saveSingleBet = (vb: ValueBet) => {
    const plugin = (() => {
      try {
        return getSport(vb.sport);
      } catch {
        return null;
      }
    })();
    const sportDisplay = plugin
      ? locale === "tr"
        ? plugin.config.displayNameTR
        : plugin.config.displayName
      : vb.sport;
    saveCoupon({
      name: `${vb.homeTeam} vs ${vb.awayTeam}`,
      strategyName: "Single Value Bet",
      totalOdds: vb.odds,
      stake: 10,
      potentialReturn: vb.odds * 10,
      riskLevel: vb.edge > 0.15 ? "low" : vb.edge > 0.08 ? "medium" : "high",
      bets: [
        {
          gameId: vb.gameId,
          sport: vb.sport,
          sportDisplay,
          homeTeam: vb.homeTeam,
          awayTeam: vb.awayTeam,
          league: "",
          matchDate: vb.matchDate,
          betType: vb.betType,
          iddaaName: vb.iddaaName,
          selection: vb.selection,
          odds: vb.odds,
          trueProbability: vb.trueProbability,
          edge: vb.edge,
          confidence: vb.confidence,
          result: "pending",
        },
      ],
    });
    toast.success(labels.saved);
  };

  const systemStrategies = strategies.filter((s) => s.systemInfo);
  const nonSystemStrategies = strategies.filter((s) => !s.systemInfo);

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div
        className="relative rounded-xl overflow-hidden p-6 sm:p-10"
        style={{
          backgroundImage: `url(${HERO_BG})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="absolute inset-0 bg-background/85 backdrop-blur-sm" />
        <div className="relative z-10">
          <h1 className="font-display text-2xl sm:text-4xl font-black neon-text mb-2 tracking-wider">
            {labels.title}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">{labels.subtitle}</p>
          <div className="flex gap-2 mt-4 flex-wrap">
            <Link
              href="/coupon-history"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-aurora/20 text-aurora border border-aurora/40 hover:bg-aurora/30 transition-colors"
            >
              <History className="w-3.5 h-3.5" /> {labels.history}
            </Link>
            <Link
              href="/system-coupons"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-ice/20 text-ice border border-ice/40 hover:bg-ice/30 transition-colors"
            >
              <Layers className="w-3.5 h-3.5" /> {labels.goToSystem}
            </Link>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <div className="flex items-center gap-2 bg-accent/30 rounded-lg px-3 py-2">
            <Calendar className="w-4 h-4 text-ice" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-sm font-mono focus:outline-none"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setShowFilters((x) => !x)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-accent/40 border border-border hover:bg-accent/60 transition-colors"
            >
              <Filter className="w-3.5 h-3.5" />
              {showFilters ? labels.hideFilters : labels.showFilters}
            </button>
            <button
              onClick={handleAnalyze}
              disabled={analyzing || filters.allowedSports.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-ice text-background hover:bg-ice/90 disabled:opacity-50 disabled:cursor-wait transition-all"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {labels.analyzing} {progress}%
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> {labels.startAnalysis}
                </>
              )}
            </button>
          </div>
        </div>

        {analyzing && (
          <div className="mt-3">
            <div className="w-full h-1.5 bg-accent/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-ice transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5 font-mono">{progressText}</p>
          </div>
        )}

        {/* Filter panel */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-border/30 space-y-4">
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  {labels.minOdds}:{" "}
                  <span className="font-mono font-bold text-ice">
                    {filters.minOdds.toFixed(2)}
                  </span>
                </label>
                <input
                  type="range"
                  min={1.01}
                  max={5}
                  step={0.05}
                  value={filters.minOdds}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, minOdds: parseFloat(e.target.value) }))
                  }
                  className="w-full mt-2 accent-ice"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  {labels.minProb}:{" "}
                  <span className="font-mono font-bold text-aurora">
                    {filters.minProbability}%
                  </span>
                </label>
                <input
                  type="range"
                  min={50}
                  max={99}
                  step={1}
                  value={filters.minProbability}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      minProbability: parseInt(e.target.value),
                    }))
                  }
                  className="w-full mt-2 accent-aurora"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  {labels.minEdge}:{" "}
                  <span className="font-mono font-bold text-warning">
                    {filters.minEdge}%
                  </span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={30}
                  step={1}
                  value={filters.minEdge}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, minEdge: parseInt(e.target.value) }))
                  }
                  className="w-full mt-2 accent-warning"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  {labels.sports}
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setFilters((f) => ({
                        ...f,
                        allowedSports: allSports.map((s) => s.config.id),
                      }))
                    }
                    className="text-[10px] text-ice hover:underline"
                  >
                    {labels.selectAll}
                  </button>
                  <button
                    onClick={() => setFilters((f) => ({ ...f, allowedSports: [] }))}
                    className="text-[10px] text-destructive hover:underline"
                  >
                    {labels.clearAll}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {allSports.map((s) => {
                  const id = s.config.id;
                  const active = filters.allowedSports.includes(id);
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

            <button
              onClick={() => setFilters({ ...DEFAULT_FILTERS })}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> {labels.resetFilters}
            </button>
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <div className="glass-card rounded-xl p-3 border border-destructive/30">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4" />
            <p className="text-xs font-semibold">
              {errors.length} {labels.errorsFound}
            </p>
          </div>
          <ul className="mt-2 text-[11px] text-muted-foreground space-y-0.5">
            {errors.map((e, i) => (
              <li key={i}>
                • <span className="font-mono">{e.sport}</span>: {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* System coupons first (priority as per spec) */}
      {systemStrategies.length > 0 && (
        <div>
          <h2 className="font-display text-lg font-bold tracking-wider neon-text flex items-center gap-2 mb-3">
            <Layers className="w-5 h-5" /> {labels.systemCoupon}
          </h2>
          <div className="space-y-3">
            {systemStrategies.map((s, i) => {
              const key = `sys-${i}-${s.name}`;
              return (
                <StrategyCard
                  key={key}
                  strategy={s}
                  saved={savedStrategies.has(key)}
                  onSave={() => saveStrategy(s, key)}
                  labels={labels}
                  locale={locale}
                  isSystem
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Main strategies */}
      <div>
        <h2 className="font-display text-lg font-bold tracking-wider neon-text flex items-center gap-2 mb-3">
          <Ticket className="w-5 h-5" /> {labels.strategies}
        </h2>
        {strategies.length === 0 && !analyzing ? (
          <div className="glass-card rounded-xl p-8 text-center">
            <AlertTriangle className="w-8 h-8 text-warning mx-auto mb-2" />
            <p className="font-semibold text-foreground">{labels.noStrategies}</p>
            <p className="text-xs text-muted-foreground mt-1">{labels.noStrategiesDesc}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {nonSystemStrategies.map((s, i) => {
              const key = `str-${i}-${s.name}`;
              return (
                <StrategyCard
                  key={key}
                  strategy={s}
                  saved={savedStrategies.has(key)}
                  onSave={() => saveStrategy(s, key)}
                  labels={labels}
                  locale={locale}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Individual value bets */}
      {valueBets.length > 0 && (
        <div>
          <h2 className="font-display text-lg font-bold tracking-wider neon-text flex items-center gap-2 mb-3">
            <Target className="w-5 h-5" /> {labels.valueBets}{" "}
            <span className="text-xs font-mono text-muted-foreground">
              ({valueBets.length})
            </span>
          </h2>
          <div className="space-y-2">
            {valueBets.slice(0, 50).map((vb, i) => (
              <div
                key={i}
                className="glass-card rounded-lg p-3 flex items-center gap-3 glass-card-hover"
              >
                <span className="text-2xl leading-none">{SPORT_ICONS[vb.sport]}</span>
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/match/${vb.sport}/${vb.gameId}`}
                    className="text-sm font-semibold truncate hover:text-ice transition-colors block"
                  >
                    {vb.homeTeam} vs {vb.awayTeam}
                  </Link>
                  <p className="text-xs text-muted-foreground truncate">
                    {vb.iddaaName}: <span className="text-foreground">{vb.selection}</span>{" "}
                    • {vb.bookmaker}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-base font-mono font-bold text-ice">
                    {vb.odds.toFixed(2)}
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase">
                    {labels.odds}
                  </p>
                </div>
                <div className="text-right shrink-0 min-w-[60px]">
                  <p className="text-sm font-mono font-bold text-aurora">
                    {(vb.trueProbability * 100).toFixed(0)}%
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase">
                    {labels.prob}
                  </p>
                </div>
                <div className="text-right shrink-0 min-w-[50px]">
                  <p
                    className={`text-sm font-mono font-bold ${
                      vb.edge > 0.15
                        ? "text-aurora"
                        : vb.edge > 0.08
                        ? "text-warning"
                        : "text-ice"
                    }`}
                  >
                    +{(vb.edge * 100).toFixed(1)}%
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase">
                    {labels.edge}
                  </p>
                </div>
                <button
                  onClick={() => saveSingleBet(vb)}
                  className="px-2 py-1 text-[10px] rounded-md bg-ice/20 text-ice border border-ice/40 hover:bg-ice/30 font-semibold whitespace-nowrap"
                >
                  <Save className="w-3 h-3 inline mr-1" />
                  {labels.save}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div className="glass-card rounded-xl p-4 border border-warning/30 bg-warning/5">
        <h4 className="text-sm font-semibold text-warning flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4" /> {labels.disclaimer}
        </h4>
        <p className="text-xs text-muted-foreground">{labels.disclaimerText}</p>
      </div>
    </div>
  );
}

function StrategyCard({
  strategy,
  saved,
  onSave,
  labels,
  locale,
  isSystem,
}: {
  strategy: CouponStrategy;
  saved: boolean;
  onSave: () => void;
  labels: any;
  locale: string;
  isSystem?: boolean;
}) {
  return (
    <div
      className={`glass-card rounded-xl p-5 border ${
        isSystem ? "border-aurora/30" : "border-ice/20"
      }`}
    >
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <h3 className="font-display text-base font-bold neon-text">{strategy.name}</h3>
            <RiskBadge level={strategy.riskLevel} labels={labels} />
            {strategy.systemInfo && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-aurora/40 text-aurora bg-aurora/10 font-bold flex items-center gap-1">
                <Layers className="w-3 h-3" /> {strategy.systemInfo.combinationType}
              </span>
            )}
            {saved && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-aurora/40 text-aurora bg-aurora/10 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> {labels.saved}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{strategy.description}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-display font-black neon-green font-mono">
            {strategy.totalOdds.toFixed(2)}
          </p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
            {labels.totalOdds}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 pb-4 border-b border-border/30">
        <MiniStat
          label={labels.expectedProb}
          value={`${strategy.expectedProbability.toFixed(1)}%`}
          color="text-ice"
        />
        <MiniStat
          label={labels.expectedValue}
          value={`${strategy.expectedValue > 1 ? "+" : ""}${(
            (strategy.expectedValue - 1) *
            100
          ).toFixed(1)}%`}
          color={strategy.expectedValue > 1 ? "text-aurora" : "text-destructive"}
        />
        <MiniStat
          label={labels.suggestedStake}
          value={`${strategy.suggestedStake} ${labels.unit}`}
          color="text-foreground"
        />
        <MiniStat
          label={labels.potentialReturn}
          value={`${strategy.potentialReturn.toFixed(0)} ${labels.unit}`}
          color="text-aurora"
        />
      </div>

      <div className="space-y-2 mb-4">
        {strategy.bets.map((b, i) => (
          <div
            key={i}
            className="flex items-center gap-3 text-xs p-2 rounded-lg bg-accent/30"
          >
            <span className="text-lg leading-none">{SPORT_ICONS[b.sport]}</span>
            <Link
              href={`/match/${b.sport}/${b.gameId}`}
              className="flex-1 min-w-0 hover:text-ice transition-colors"
            >
              <p className="font-semibold truncate">
                {b.homeTeam} vs {b.awayTeam}
              </p>
              <p className="text-muted-foreground truncate">
                {b.iddaaName}: {b.selection}
              </p>
            </Link>
            <span className="font-mono font-bold text-ice shrink-0">
              {b.odds.toFixed(2)}
            </span>
            <span className="font-mono text-aurora font-bold text-[10px] shrink-0">
              +{(b.edge * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={onSave}
        disabled={saved}
        className={`w-full py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
          saved
            ? "bg-aurora/20 text-aurora border border-aurora/40 cursor-default"
            : "bg-ice text-background hover:bg-ice/90"
        }`}
      >
        {saved ? (
          <>
            <CheckCircle2 className="w-4 h-4" /> {labels.saved}
          </>
        ) : (
          <>
            <BookmarkPlus className="w-4 h-4" /> {labels.save}
          </>
        )}
      </button>
    </div>
  );
}

function RiskBadge({
  level,
  labels,
}: {
  level: "low" | "medium" | "high" | "very-high";
  labels: any;
}) {
  const cls = {
    low: "bg-aurora/20 text-aurora border-aurora/40",
    medium: "bg-ice/20 text-ice border-ice/40",
    high: "bg-warning/20 text-warning border-warning/40",
    "very-high": "bg-destructive/20 text-destructive border-destructive/40",
  }[level];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}
    >
      <Shield className="w-3 h-3" />
      {labels.risk[level]}
    </span>
  );
}

function MiniStat({
  label,
  value,
  color = "text-foreground",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
        {label}
      </p>
      <p className={`text-sm font-mono font-bold ${color}`}>{value}</p>
    </div>
  );
}
