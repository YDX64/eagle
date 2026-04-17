/**
 * SystemCoupons - Dedicated N/K system coupon generator
 *
 * Flow:
 * 1. Select date + sports
 * 2. Click "Sistem Bahisi Üret" -> fetch high probability candidates
 * 3. User ticks N bets (5-8)
 * 4. Pick N (combinations size) -> show all C(N, K) combos with total odds
 * 5. Display expected returns by scenario
 */
import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import {
  Loader2,
  Layers,
  Calendar,
  Sparkles,
  Save,
  AlertTriangle,
  ChevronRight,
  ArrowLeft,
  Target,
  CheckCircle2,
  Info,
  X,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { allSports, popularSports, getSport } from "@/sports/registry";
import { useLocale } from "@/contexts/LocaleContext";
import {
  analyzeMultiSport,
  calculateSystemProbability,
  DEFAULT_FILTERS,
} from "@/lib/couponEngine";
import { saveCoupon } from "@/lib/couponStorage";
import type {
  SportId,
  ValueBet,
  CouponFilterConfig,
  CouponBet,
} from "@/sports/_core/types";

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

function binomialC(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let c = 1;
  for (let i = 0; i < k; i++) {
    c = (c * (n - i)) / (i + 1);
  }
  return Math.round(c);
}

function allCombinations<T>(arr: T[], k: number): T[][] {
  const results: T[][] = [];
  const run = (start: number, combo: T[]) => {
    if (combo.length === k) {
      results.push([...combo]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      run(i + 1, combo);
      combo.pop();
    }
  };
  run(0, []);
  return results;
}

export default function SystemCoupons() {
  const { locale } = useLocale();
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [selectedSports, setSelectedSports] = useState<SportId[]>(
    popularSports.map((s) => s.config.id)
  );
  const [minProb, setMinProb] = useState(70);
  const [minOdds, setMinOdds] = useState(1.6);
  const [analyzing, setAnalyzing] = useState(false);
  const [candidates, setCandidates] = useState<ValueBet[]>([]);
  const [selectedBets, setSelectedBets] = useState<ValueBet[]>([]);
  const [combinationSize, setCombinationSize] = useState(3);
  const [stakePerCombo, setStakePerCombo] = useState(5);
  const [progressText, setProgressText] = useState("");
  const [progress, setProgress] = useState(0);
  const [saved, setSaved] = useState(false);

  const labels = useMemo(() => {
    if (locale === "tr") {
      return {
        back: "Kupon Üretici",
        title: "SİSTEM KUPONU ÜRETİCİ",
        subtitle: "5-8 bahisten N'i tutması yeterli — risk dağıtılmış kupon",
        date: "Tarih",
        filters: "Filtreler",
        minProb: "Min Olasılık",
        minOdds: "Min Oran",
        sports: "Sporlar",
        generate: "Sistem Bahisi Üret",
        analyzing: "Analiz ediliyor",
        candidates: "YÜKSEK OLASILIKLI ADAYLAR",
        noCandidates: "Henüz aday yok. 'Sistem Bahisi Üret'e tıklayın.",
        selectBets: "Bahisleri Seç",
        selectedCount: "seçildi",
        minRequired: "min 5 seçin",
        comboSize: "Kombinasyon Boyutu (N)",
        combinations: "Kombinasyonlar",
        totalOdds: "Toplam Oran",
        matchProb: "Tutma Olasılığı",
        stakePerCombo: "Kupon Başına Yatırım",
        unit: "birim",
        totalStake: "Toplam Yatırım",
        maxReturn: "Maksimum Kazanç",
        expectedReturn: "Beklenen Kazanç",
        scenarios: "SENARYOLAR",
        scenario: "senaryo",
        allMatch: "Hepsi tutarsa",
        nMatch: "tutarsa",
        probability: "Olasılık",
        return: "Kazanç",
        profit: "Kar",
        saveCoupon: "Sistem Kuponunu Kaydet",
        saved: "Kaydedildi",
        howItWorks: "Nasıl Çalışır?",
        howItWorksDesc:
          "Sistem kuponda N bahisten K'sı tutması yeterli. Örneğin 5 bahis seçip 3'lü sistem oynarsanız, 10 farklı 3'lü kombinasyon üretilir. 3'ünün tutması kupon kazanmak için yeterlidir (diğer 2'si kaybetse bile diğer kombinasyonlar kazanabilir).",
        remove: "Kaldır",
        clear: "Temizle",
      };
    }
    if (locale === "sv") {
      return {
        back: "Kuponggenerator",
        title: "SYSTEMKUPONGGENERATOR",
        subtitle: "N av 5-8 spel räcker — spridd risk",
        date: "Datum",
        filters: "Filter",
        minProb: "Min Sannolikhet",
        minOdds: "Min Odds",
        sports: "Sporter",
        generate: "Generera Systemspel",
        analyzing: "Analyserar",
        candidates: "HÖGT SANNOLIKA KANDIDATER",
        noCandidates: "Inga kandidater än.",
        selectBets: "Välj Spel",
        selectedCount: "valda",
        minRequired: "välj minst 5",
        comboSize: "Kombinationsstorlek (N)",
        combinations: "Kombinationer",
        totalOdds: "Totala Odds",
        matchProb: "Sannolikhet Att Vinna",
        stakePerCombo: "Insats per Kombination",
        unit: "enhet",
        totalStake: "Total Insats",
        maxReturn: "Maxvinst",
        expectedReturn: "Förväntad Vinst",
        scenarios: "SCENARIER",
        scenario: "scenario",
        allMatch: "Alla vinner",
        nMatch: "vinner",
        probability: "Sannolikhet",
        return: "Vinst",
        profit: "Profit",
        saveCoupon: "Spara Systemkupong",
        saved: "Sparad",
        howItWorks: "Hur Fungerar Det?",
        howItWorksDesc:
          "I ett systemspel räcker det att K av N spel vinner. Om du väljer 5 spel och spelar 3-system genereras 10 unika trippelkombinationer.",
        remove: "Ta bort",
        clear: "Rensa",
      };
    }
    return {
      back: "Coupon Generator",
      title: "SYSTEM COUPON GENERATOR",
      subtitle: "N of 5-8 bets wins — spread risk",
      date: "Date",
      filters: "Filters",
      minProb: "Min Probability",
      minOdds: "Min Odds",
      sports: "Sports",
      generate: "Generate System Bet",
      analyzing: "Analyzing",
      candidates: "HIGH PROBABILITY CANDIDATES",
      noCandidates: "No candidates yet.",
      selectBets: "Select Bets",
      selectedCount: "selected",
      minRequired: "select at least 5",
      comboSize: "Combination Size (N)",
      combinations: "Combinations",
      totalOdds: "Total Odds",
      matchProb: "Win Probability",
      stakePerCombo: "Stake per Combo",
      unit: "units",
      totalStake: "Total Stake",
      maxReturn: "Max Return",
      expectedReturn: "Expected Return",
      scenarios: "SCENARIOS",
      scenario: "scenario",
      allMatch: "All match",
      nMatch: "match",
      probability: "Probability",
      return: "Return",
      profit: "Profit",
      saveCoupon: "Save System Coupon",
      saved: "Saved",
      howItWorks: "How It Works?",
      howItWorksDesc:
        "In a system bet, K of N selections need to hit. For example, selecting 5 bets with a 3-system creates 10 different triple combinations.",
      remove: "Remove",
      clear: "Clear",
    };
  }, [locale]);

  const runAnalyze = async () => {
    setAnalyzing(true);
    setCandidates([]);
    setSelectedBets([]);
    setSaved(false);
    setProgress(0);
    setProgressText("");

    const sports = allSports.filter((s) => selectedSports.includes(s.config.id));
    const filters: CouponFilterConfig = {
      ...DEFAULT_FILTERS,
      minOdds,
      minProbability: minProb,
      minEdge: 0,
      allowedSports: selectedSports,
    };

    try {
      const result = await analyzeMultiSport({
        sports,
        date,
        filters,
        onProgress: (sportId, done) => {
          setProgressText(`${sportId} ${done}`);
          const idx = sports.findIndex((s) => s.config.id === sportId) + 1;
          setProgress(Math.round((idx / sports.length) * 95));
        },
      });

      // Dedupe one per game (best prob)
      const bestPerGame = new Map<string, ValueBet>();
      result.valueBets.forEach((vb) => {
        const key = `${vb.sport}-${vb.gameId}`;
        const ex = bestPerGame.get(key);
        if (!ex || vb.trueProbability > ex.trueProbability) bestPerGame.set(key, vb);
      });
      const sorted = Array.from(bestPerGame.values()).sort(
        (a, b) => b.trueProbability - a.trueProbability
      );

      setCandidates(sorted.slice(0, 30));
      setProgress(100);
      toast.success(`${sorted.length} ${locale === "tr" ? "aday bulundu" : "candidates"}`);
    } catch (err: any) {
      toast.error(err.message || "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleBet = (vb: ValueBet) => {
    setSelectedBets((prev) => {
      const key = `${vb.sport}-${vb.gameId}-${vb.betType}-${vb.selection}`;
      const existing = prev.find(
        (b) => `${b.sport}-${b.gameId}-${b.betType}-${b.selection}` === key
      );
      if (existing) {
        return prev.filter(
          (b) => `${b.sport}-${b.gameId}-${b.betType}-${b.selection}` !== key
        );
      }
      if (prev.length >= 8) {
        toast.info(locale === "tr" ? "Maksimum 8 bahis" : "Max 8 bets");
        return prev;
      }
      return [...prev, vb];
    });
  };

  // Ensure comboSize is valid
  useEffect(() => {
    if (selectedBets.length > 0 && combinationSize >= selectedBets.length) {
      setCombinationSize(Math.max(2, selectedBets.length - 1));
    }
  }, [selectedBets.length, combinationSize]);

  const analysis = useMemo(() => {
    if (selectedBets.length < 2) return null;
    const N = selectedBets.length;
    const K = Math.min(combinationSize, N - 1);
    const combos = allCombinations(selectedBets, K);
    const combosCount = combos.length;

    // Calculate each combination's total odds and probability
    const comboDetails = combos.map((combo) => {
      const totalOdds = combo.reduce((a, b) => a * b.odds, 1);
      const prob = combo.reduce((a, b) => a * b.trueProbability, 1);
      return { totalOdds, prob, bets: combo };
    });
    const avgOdds = comboDetails.reduce((a, b) => a + b.totalOdds, 0) / combosCount;
    const avgProb = comboDetails.reduce((a, b) => a + b.prob, 0) / combosCount;

    const totalStake = stakePerCombo * combosCount;
    const maxReturn = comboDetails.reduce((a, b) => a + b.totalOdds * stakePerCombo, 0);
    const expectedReturn = comboDetails.reduce((a, b) => a + b.totalOdds * stakePerCombo * b.prob, 0);

    // Scenarios: probability of exactly k wins from N
    const probs = selectedBets.map((b) => b.trueProbability);
    const scenarios: {
      wins: number;
      probability: number;
      winningCombos: number;
      return: number;
      profit: number;
    }[] = [];
    for (let wins = K; wins <= N; wins++) {
      // P(exactly `wins` wins out of N):
      const pExact = exactKSuccesses(probs, wins);
      // Winning combinations = C(wins, K) * ... more precisely: from any K-subset of the winners, that combo wins
      // If `wins` of N are winners, number of winning K-combos = C(wins, K)
      const winningCombos = binomialC(wins, K);
      // Average odds per combo multiplied by winning combos and stake = total return in that scenario
      // But more precise: return depends on WHICH combos; we use avg.
      const scenarioReturn = winningCombos * avgOdds * stakePerCombo;
      scenarios.push({
        wins,
        probability: pExact,
        winningCombos,
        return: scenarioReturn,
        profit: scenarioReturn - totalStake,
      });
    }

    return {
      N,
      K,
      combosCount,
      avgOdds,
      avgProb,
      totalStake,
      maxReturn,
      expectedReturn,
      scenarios,
      systemProb: calculateSystemProbability(probs, K),
      comboDetails,
    };
  }, [selectedBets, combinationSize, stakePerCombo]);

  const saveSystemCoupon = () => {
    if (!analysis || selectedBets.length < 2) return;
    const bets: CouponBet[] = selectedBets.map((vb) => {
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
      return {
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
      };
    });

    saveCoupon({
      name: `${labels.title} ${analysis.K}/${analysis.N}`,
      strategyName: `System ${analysis.K}/${analysis.N}`,
      totalOdds: analysis.avgOdds,
      stake: analysis.totalStake,
      potentialReturn: analysis.maxReturn,
      riskLevel:
        analysis.systemProb > 0.4
          ? "low"
          : analysis.systemProb > 0.2
          ? "medium"
          : "high",
      bets,
    });
    setSaved(true);
    toast.success(labels.saved);
  };

  return (
    <div className="space-y-5">
      <Link
        href="/coupons"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> {labels.back}
      </Link>

      <div className="glass-card rounded-xl p-6 border border-aurora/20">
        <h1 className="font-display text-2xl sm:text-4xl font-black neon-text mb-2 tracking-wider flex items-center gap-3">
          <Layers className="w-8 h-8" /> {labels.title}
        </h1>
        <p className="text-sm text-muted-foreground">{labels.subtitle}</p>
      </div>

      {/* How it works */}
      <div className="glass-card rounded-xl p-4 border border-ice/20">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 text-ice shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-ice mb-1">{labels.howItWorks}</h3>
            <p className="text-xs text-muted-foreground">{labels.howItWorksDesc}</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="glass-card rounded-xl p-4 space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              {labels.date}
            </label>
            <div className="mt-1 flex items-center gap-2 bg-accent/30 rounded-lg px-3 py-2">
              <Calendar className="w-4 h-4 text-ice" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-transparent text-sm font-mono focus:outline-none flex-1"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              {labels.minOdds}:{" "}
              <span className="font-mono font-bold text-ice">{minOdds.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={1.01}
              max={5}
              step={0.05}
              value={minOdds}
              onChange={(e) => setMinOdds(parseFloat(e.target.value))}
              className="w-full mt-2 accent-ice"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              {labels.minProb}:{" "}
              <span className="font-mono font-bold text-aurora">{minProb}%</span>
            </label>
            <input
              type="range"
              min={50}
              max={95}
              step={1}
              value={minProb}
              onChange={(e) => setMinProb(parseInt(e.target.value))}
              className="w-full mt-2 accent-aurora"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={runAnalyze}
              disabled={analyzing || selectedSports.length === 0}
              className="w-full inline-flex items-center gap-2 justify-center px-4 py-2 rounded-lg text-sm font-bold bg-aurora text-background hover:bg-aurora/90 disabled:opacity-50 disabled:cursor-wait transition-all"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> {progress}%
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> {labels.generate}
                </>
              )}
            </button>
          </div>
        </div>

        {analyzing && (
          <div>
            <div className="w-full h-1 bg-accent/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-aurora transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5 font-mono">
              {progressText}
            </p>
          </div>
        )}

        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2 block">
            {labels.sports}
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {allSports.map((s) => {
              const id = s.config.id;
              const active = selectedSports.includes(id);
              return (
                <button
                  key={id}
                  onClick={() =>
                    setSelectedSports((prev) =>
                      active ? prev.filter((x) => x !== id) : [...prev, id]
                    )
                  }
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs transition-all ${
                    active
                      ? "bg-aurora/20 border-aurora/40 text-aurora"
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
      </div>

      {/* Candidates */}
      {candidates.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg font-bold tracking-wider neon-text flex items-center gap-2">
              <Target className="w-5 h-5" /> {labels.candidates}
            </h2>
            <div className="text-xs text-muted-foreground">
              <span className="font-mono font-bold text-aurora">
                {selectedBets.length}
              </span>{" "}
              / 8 {labels.selectedCount}
              {selectedBets.length < 5 && (
                <span className="text-warning ml-2">({labels.minRequired})</span>
              )}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {candidates.map((vb, i) => {
              const key = `${vb.sport}-${vb.gameId}-${vb.betType}-${vb.selection}`;
              const isSelected = selectedBets.find(
                (b) => `${b.sport}-${b.gameId}-${b.betType}-${b.selection}` === key
              );
              return (
                <button
                  key={i}
                  onClick={() => toggleBet(vb)}
                  className={`flex items-center gap-3 p-3 rounded-lg transition-all text-left ${
                    isSelected
                      ? "glass-card neon-border"
                      : "glass-card glass-card-hover"
                  }`}
                >
                  <span className="text-2xl leading-none">{SPORT_ICONS[vb.sport]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {vb.homeTeam} vs {vb.awayTeam}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {vb.iddaaName}: {vb.selection}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-mono font-bold text-ice">
                      {vb.odds.toFixed(2)}
                    </p>
                    <p className="text-[10px] font-mono text-aurora font-bold">
                      {(vb.trueProbability * 100).toFixed(0)}%
                    </p>
                  </div>
                  {isSelected && (
                    <CheckCircle2 className="w-5 h-5 text-aurora shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {candidates.length === 0 && !analyzing && (
        <div className="glass-card rounded-xl p-8 text-center">
          <Layers className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">{labels.noCandidates}</p>
        </div>
      )}

      {/* System configuration */}
      {selectedBets.length >= 2 && analysis && (
        <div className="space-y-4">
          <div className="glass-card rounded-xl p-5 border border-aurora/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-base font-bold text-aurora flex items-center gap-2">
                <Layers className="w-5 h-5" /> {labels.selectBets}: {selectedBets.length}
              </h3>
              <button
                onClick={() => setSelectedBets([])}
                className="text-xs text-destructive hover:underline flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> {labels.clear}
              </button>
            </div>

            <div className="space-y-1 mb-4">
              {selectedBets.map((vb, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs p-2 rounded-lg bg-accent/30"
                >
                  <span className="text-base leading-none">{SPORT_ICONS[vb.sport]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">
                      {vb.homeTeam} vs {vb.awayTeam}
                    </p>
                    <p className="text-muted-foreground truncate">
                      {vb.iddaaName}: {vb.selection}
                    </p>
                  </div>
                  <span className="font-mono font-bold text-ice shrink-0">
                    {vb.odds.toFixed(2)}
                  </span>
                  <span className="font-mono font-bold text-aurora text-[10px] shrink-0">
                    {(vb.trueProbability * 100).toFixed(0)}%
                  </span>
                  <button
                    onClick={() => toggleBet(vb)}
                    className="text-destructive hover:bg-destructive/10 p-1 rounded"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-4 pt-3 border-t border-border/30">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  {labels.comboSize}:{" "}
                  <span className="font-mono font-bold text-aurora">
                    {combinationSize}/{selectedBets.length}
                  </span>
                </label>
                <input
                  type="range"
                  min={2}
                  max={Math.max(2, selectedBets.length - 1)}
                  step={1}
                  value={combinationSize}
                  onChange={(e) => setCombinationSize(parseInt(e.target.value))}
                  className="w-full mt-2 accent-aurora"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  {labels.stakePerCombo}:{" "}
                  <span className="font-mono font-bold text-ice">
                    {stakePerCombo} {labels.unit}
                  </span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={50}
                  step={1}
                  value={stakePerCombo}
                  onChange={(e) => setStakePerCombo(parseInt(e.target.value))}
                  className="w-full mt-2 accent-ice"
                />
              </div>
            </div>
          </div>

          {/* Analysis output */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile
              label={labels.combinations}
              value={analysis.combosCount.toString()}
              color="text-aurora"
            />
            <StatTile
              label={labels.totalOdds}
              value={analysis.avgOdds.toFixed(2)}
              color="text-ice"
              prefix="Ø"
            />
            <StatTile
              label={labels.matchProb}
              value={`${(analysis.systemProb * 100).toFixed(1)}%`}
              color="text-aurora"
            />
            <StatTile
              label={labels.totalStake}
              value={`${analysis.totalStake}`}
              color="text-foreground"
              suffix={` ${labels.unit}`}
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="glass-card rounded-xl p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                {labels.maxReturn}
              </p>
              <p className="text-2xl font-display font-black neon-green font-mono">
                {analysis.maxReturn.toFixed(0)} {labels.unit}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                +{(analysis.maxReturn - analysis.totalStake).toFixed(0)} {labels.profit}
              </p>
            </div>
            <div className="glass-card rounded-xl p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                {labels.expectedReturn}
              </p>
              <p className="text-2xl font-display font-black text-ice font-mono">
                {analysis.expectedReturn.toFixed(0)} {labels.unit}
              </p>
              <p
                className={`text-xs mt-1 ${
                  analysis.expectedReturn > analysis.totalStake
                    ? "text-aurora"
                    : "text-destructive"
                }`}
              >
                {analysis.expectedReturn > analysis.totalStake ? "+" : ""}
                {(analysis.expectedReturn - analysis.totalStake).toFixed(0)} {labels.profit}
              </p>
            </div>
          </div>

          {/* Scenarios */}
          <div className="glass-card rounded-xl p-4">
            <h4 className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-3">
              {labels.scenarios}
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/30">
                    <th className="text-left px-2 py-1.5">{labels.scenario}</th>
                    <th className="text-right px-2 py-1.5">{labels.probability}</th>
                    <th className="text-right px-2 py-1.5">{labels.combinations}</th>
                    <th className="text-right px-2 py-1.5">{labels.return}</th>
                    <th className="text-right px-2 py-1.5">{labels.profit}</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.scenarios
                    .slice()
                    .reverse()
                    .map((sc, i) => (
                      <tr
                        key={i}
                        className="border-b border-border/10 hover:bg-accent/20"
                      >
                        <td className="px-2 py-1.5">
                          {sc.wins === analysis.N ? (
                            <span className="text-aurora font-bold">
                              {labels.allMatch}
                            </span>
                          ) : (
                            <span>
                              {sc.wins} {labels.nMatch}
                            </span>
                          )}
                        </td>
                        <td className="text-right px-2 py-1.5 font-mono">
                          {(sc.probability * 100).toFixed(2)}%
                        </td>
                        <td className="text-right px-2 py-1.5 font-mono text-muted-foreground">
                          {sc.winningCombos}
                        </td>
                        <td className="text-right px-2 py-1.5 font-mono font-bold text-ice">
                          {sc.return.toFixed(0)}
                        </td>
                        <td
                          className={`text-right px-2 py-1.5 font-mono font-bold ${
                            sc.profit > 0 ? "text-aurora" : "text-destructive"
                          }`}
                        >
                          {sc.profit > 0 ? "+" : ""}
                          {sc.profit.toFixed(0)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Combinations preview */}
          {analysis.comboDetails.length <= 50 && (
            <div className="glass-card rounded-xl p-4">
              <h4 className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-3">
                {labels.combinations}
              </h4>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {analysis.comboDetails.map((c, i) => (
                  <div
                    key={i}
                    className="bg-accent/20 rounded-lg p-2 border border-border/20"
                  >
                    <div className="flex justify-between items-center text-[10px] text-muted-foreground mb-1">
                      <span>
                        {locale === "tr" ? "Kombinasyon" : "Combination"} #{i + 1}
                      </span>
                      <span className="font-mono font-bold text-ice">
                        {c.totalOdds.toFixed(2)}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {c.bets.map((b, j) => (
                        <div
                          key={j}
                          className="text-[10px] flex gap-1 items-center"
                        >
                          <span>{SPORT_ICONS[b.sport]}</span>
                          <span className="truncate">
                            {b.homeTeam.slice(0, 10)} · {b.selection}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={saveSystemCoupon}
            disabled={saved}
            className={`w-full py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${
              saved
                ? "bg-aurora/20 text-aurora border border-aurora/40 cursor-default"
                : "bg-aurora text-background hover:bg-aurora/90"
            }`}
          >
            {saved ? (
              <>
                <CheckCircle2 className="w-5 h-5" /> {labels.saved}
              </>
            ) : (
              <>
                <Save className="w-5 h-5" /> {labels.saveCoupon}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

function exactKSuccesses(probs: number[], k: number): number {
  const n = probs.length;
  if (k < 0 || k > n) return 0;
  // DP: dp[j] = probability of exactly j successes so far
  let dp = new Array(n + 1).fill(0);
  dp[0] = 1;
  for (let i = 0; i < n; i++) {
    const next = new Array(n + 1).fill(0);
    for (let j = 0; j <= i + 1; j++) {
      if (j > 0) next[j] += dp[j - 1] * probs[i];
      next[j] += dp[j] * (1 - probs[i]);
    }
    dp = next;
  }
  return dp[k];
}

function StatTile({
  label,
  value,
  color,
  prefix,
  suffix,
}: {
  label: string;
  value: string;
  color: string;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="glass-card rounded-xl p-4">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
        {label}
      </p>
      <p className={`text-xl font-display font-black font-mono ${color}`}>
        {prefix}
        {value}
        {suffix}
      </p>
    </div>
  );
}
