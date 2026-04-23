"use client";

import { useMemo, type ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Trophy,
  ShieldCheck,
  Clock3,
  Goal,
  BarChart2,
} from "lucide-react";
import type { AdvancedMatchPrediction } from "@/lib/advanced-prediction-engine";

interface ApiPredictionRaw {
  predictions?: {
    winner?: {
      name?: string;
      comment?: string;
    };
    win_or_draw?: boolean;
    under_over?: string | { goals?: string };
    goals?: {
      home?: string;
      away?: string;
    };
    advice?: string;
    percent?: {
      home?: string;
      draw?: string;
      away?: string;
    };
  };
  comparison?: {
    form?: {
      home?: string;
      away?: string;
    };
  };
}

interface MatchMeta {
  league: string;
  date: string;
  time: string;
  homeTeam: {
    name: string;
    logo?: string | null;
    form?: string[];
  };
  awayTeam: {
    name: string;
    logo?: string | null;
    form?: string[];
  };
}

interface PredictionDetailedViewProps {
  match: MatchMeta;
  advancedPrediction: AdvancedMatchPrediction;
  apiPrediction: ApiPredictionRaw | null;
}

const parsePercent = (value?: string | null): number | null => {
  if (!value) return null;
  const cleaned = value.replace("%", "").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
};

const normalizeWinner = (
  winnerName: string | undefined,
  home: string,
  away: string
): "home" | "draw" | "away" | null => {
  if (!winnerName) return null;
  const value = winnerName.toLowerCase();
  if (value.includes("draw")) return "draw";
  if (value.includes("home") || value.includes(home.toLowerCase())) return "home";
  if (value.includes("away") || value.includes(away.toLowerCase())) return "away";
  return null;
};

const normalizeOverUnder = (value?: string | null) => {
  if (!value) return { direction: null as "over" | "under" | null, line: null as number | null };
  const lower = value.toLowerCase();
  const direction = lower.includes("over") ? "over" : lower.includes("under") ? "under" : null;
  const lineMatch = lower.match(/([0-9]+(?:\.[0-9]+)?)/);
  const line = lineMatch ? parseFloat(lineMatch[1]) : null;
  return { direction, line };
};

const mapApiPrediction = (
  apiPrediction: ApiPredictionRaw | null,
  home: string,
  away: string
) => {
  if (!apiPrediction?.predictions) {
    return {
      winner: null as "home" | "away" | "draw" | null,
      winnerConfidence: null as number | null,
      overUnder: null as "over" | "under" | null,
      overUnderLine: null as number | null,
      advice: apiPrediction?.predictions?.advice ?? null,
    };
  }

  const pred = apiPrediction.predictions;
  const winner = normalizeWinner(pred.winner?.name, home, away);
  const winnerConfidence = winner ? parsePercent(pred.percent?.[winner]) : null;

  const rawUnderOver = typeof pred.under_over === "string" ? pred.under_over : pred.under_over?.goals;
  const { direction, line } = normalizeOverUnder(rawUnderOver ?? pred.advice);

  return {
    winner,
    winnerConfidence,
    overUnder: direction,
    overUnderLine: line,
    advice: pred.advice ?? null,
  };
};

type BankoPick = {
  label: string;
  description: string;
  confidence: number;
  odds?: number;
};

const BankoThresholds = {
  minConfidence: 0.65,
  minOdds: 1.35,
};

const formatProbability = (value: number, digits = 0) => `${value.toFixed(digits)}%`;

const formatMarketLabel = (key: string) => {
  const cleaned = key.replace("total_", "").replace(/_/g, " ");
  const [direction, line] = cleaned.split(" ");
  const upper = direction?.toUpperCase();
  return `${upper} ${line}`;
};

export function PredictionDetailedView({
  match,
  advancedPrediction,
  apiPrediction,
}: PredictionDetailedViewProps) {
  const apiSummary = useMemo(
    () => mapApiPrediction(apiPrediction, match.homeTeam.name, match.awayTeam.name),
    [apiPrediction, match.homeTeam.name, match.awayTeam.name]
  );

  const winnerStats = advancedPrediction.match_result;
  const ourWinner = useMemo(() => {
    const entries: Array<{ key: "home" | "draw" | "away"; prob: number; odds: number }> = [
      { key: "home", prob: winnerStats.home_win.probability, odds: winnerStats.home_win.odds },
      { key: "draw", prob: winnerStats.draw.probability, odds: winnerStats.draw.odds },
      { key: "away", prob: winnerStats.away_win.probability, odds: winnerStats.away_win.odds },
    ];
    return entries.sort((a, b) => b.prob - a.prob)[0];
  }, [winnerStats]);

  const doubleChanceStats = useMemo(() => {
    const homeProb = winnerStats.home_win.probability;
    const drawProb = winnerStats.draw.probability;
    const awayProb = winnerStats.away_win.probability;
    return {
      "1X": homeProb + drawProb,
      "12": homeProb + awayProb,
      "X2": drawProb + awayProb,
    };
  }, [winnerStats]);

  const overUnderStats = advancedPrediction.total_goals;
  const overUnder2_5 = useMemo(() => ({
    over: overUnderStats.over_2_5.probability,
    under: overUnderStats.under_2_5.probability,
  }), [overUnderStats]);

  const exactScore = advancedPrediction.exact_scores?.[0];
  const primaryScore = useMemo(() => {
    if (exactScore?.score) {
      const [home, away] = exactScore.score.split("-").map((n) => parseInt(n.trim(), 10));
      return {
        home: Number.isFinite(home) ? home : 0,
        away: Number.isFinite(away) ? away : 0,
        label: `En olası skor (%${exactScore.probability})`,
      };
    }
    const approxHome = Math.max(0, Math.round(advancedPrediction.home_team_goals.over_0_5 - advancedPrediction.home_team_goals.under_0_5));
    const approxAway = Math.max(0, Math.round(advancedPrediction.away_team_goals.over_0_5 - advancedPrediction.away_team_goals.under_0_5));
    return {
      home: approxHome,
      away: approxAway,
      label: `Tahmini skor ${approxHome}-${approxAway}`,
    };
  }, [exactScore, advancedPrediction.home_team_goals, advancedPrediction.away_team_goals]);

  const bankoPicks = useMemo<BankoPick[]>(() => {
    const picks: BankoPick[] = [];

    if (
      apiSummary.winner &&
      apiSummary.winner === ourWinner.key &&
      ourWinner.prob / 100 >= BankoThresholds.minConfidence &&
      (ourWinner.odds ?? 0) >= BankoThresholds.minOdds
    ) {
      const label =
        apiSummary.winner === "home"
          ? `MS1 (${match.homeTeam.name})`
          : apiSummary.winner === "away"
          ? `MS2 (${match.awayTeam.name})`
          : "MS0 (Beraberlik)";
      picks.push({
        label,
        description: "API & model maç sonucunda hemfikir",
        confidence: ourWinner.prob,
        odds: ourWinner.odds,
      });
    }

    if (apiPrediction?.predictions?.win_or_draw && doubleChanceStats["1X"] >= 70) {
      picks.push({
        label: `1X (${match.homeTeam.name} kaybetmez)`,
        description: "Win/Draw tavsiyesi her iki taraftan da onaylı",
        confidence: doubleChanceStats["1X"],
      });
    }

    if (apiSummary.overUnder === "over" && apiSummary.overUnderLine === 2.5 && overUnder2_5.over >= 70) {
      picks.push({
        label: "Over 2.5",
        description: "Goller için çift algoritma uyumu",
        confidence: overUnder2_5.over,
      });
    }

    if (apiSummary.overUnder === "under" && apiSummary.overUnderLine === 2.5 && overUnder2_5.under >= 70) {
      picks.push({
        label: "Under 2.5",
        description: "Goller için çift algoritma uyumu",
        confidence: overUnder2_5.under,
      });
    }

    return picks.sort((a, b) => b.confidence - a.confidence);
  }, [apiSummary, apiPrediction, doubleChanceStats, match.homeTeam.name, match.awayTeam.name, ourWinner, overUnder2_5]);

  const cardPredictions = useMemo(() => {
    return Object.entries(advancedPrediction.cards)
      .map(([key, value]) => ({ label: formatMarketLabel(key), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 2);
  }, [advancedPrediction.cards]);

  const cornerPredictions = useMemo(() => {
    return Object.entries(advancedPrediction.corners)
      .map(([key, value]) => ({ label: formatMarketLabel(key), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 2);
  }, [advancedPrediction.corners]);

  const highConfidence = advancedPrediction.risk_analysis.high_confidence_bets ?? [];
  const mediumConfidence = advancedPrediction.risk_analysis.medium_risk_bets ?? [];
  const highRisk = advancedPrediction.risk_analysis.high_risk_bets ?? [];

  return (
    <div className="space-y-6">
      <Card className="border border-emerald-700/40 bg-gradient-to-br from-slate-950 via-emerald-950 to-slate-900 text-slate-50">
        <CardHeader className="space-y-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-6">
              <TeamBadge name={match.homeTeam.name} logo={match.homeTeam.logo} form={match.homeTeam.form} align="left" />
              <div className="space-y-2 text-center lg:text-left">
                <CardTitle className="flex flex-wrap items-center justify-center gap-3 text-emerald-200 text-2xl lg:justify-start">
                  <Trophy className="h-6 w-6 text-emerald-400" />
                  {match.homeTeam.name}
                  <span className="text-slate-400">vs</span>
                  {match.awayTeam.name}
                </CardTitle>
                <CardDescription className="flex flex-wrap items-center justify-center gap-2 text-emerald-100 lg:justify-start">
                  <span>{match.league}</span>
                  <span className="mx-1 hidden sm:inline text-emerald-300">•</span>
                  <span>{match.date}</span>
                  <span className="mx-1 hidden sm:inline text-emerald-300">•</span>
                  <span>{match.time}</span>
                </CardDescription>
                {apiSummary.advice && (
                  <div className="flex items-center justify-center gap-2 text-sm text-emerald-200/80 lg:justify-start">
                    <ShieldCheck className="h-4 w-4 text-emerald-300" />
                    {apiSummary.advice}
                  </div>
                )}
              </div>
              <TeamBadge name={match.awayTeam.name} logo={match.awayTeam.logo} form={match.awayTeam.form} align="right" />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm lg:w-auto">
              <SummaryTile label="Banko Picks" value={bankoPicks.length.toString()} helper="Çift onaylı seçimler" />
              <SummaryTile label="Winner Agreement" value={apiSummary.winner ? 'Evet' : 'Hayır'} helper="API & model" />
              <SummaryTile label="Over/Under" value={apiSummary.overUnder ? `${apiSummary.overUnder.toUpperCase()} ${apiSummary.overUnderLine ?? ''}` : '-'} helper="API tavsiyesi" />
              <SummaryTile label="Çifte Şans 1X" value={formatProbability(doubleChanceStats['1X'])} helper="Ev kaybetmez" />
            </div>
          </div>
          <div className="rounded border border-emerald-600/40 bg-emerald-950/30 p-4 flex flex-col items-center gap-6 md:flex-row md:justify-between">
            <div className="text-center md:text-left">
              <div className="text-sm text-emerald-200/80">Tahmini Skor</div>
              <div className="text-4xl font-bold text-emerald-200">
                {primaryScore.home} : {primaryScore.away}
              </div>
              <div className="text-xs text-emerald-300/80 mt-1">{primaryScore.label}</div>
            </div>
            <div className="flex gap-8 text-sm">
              <ProbabilityBadge label="Ev" value={winnerStats.home_win.probability} />
              <ProbabilityBadge label="Beraberlik" value={winnerStats.draw.probability} />
              <ProbabilityBadge label="Deplasman" value={winnerStats.away_win.probability} />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 border-t border-emerald-800/40 bg-slate-900/40">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 rounded border border-emerald-600/40 bg-emerald-950/30 p-4">
              <SectionHeading icon={<Clock3 className="h-4 w-4" />} title="İlk Yarı Tahminleri" badge={`Toplam BGS ${(advancedPrediction.first_half_goals.over_0_5.probability / 100 * 0.6).toFixed(2)}`}/>
              <div className="grid gap-2">
                <PredictionStatRow label="Over 0.5" value={advancedPrediction.first_half_goals.over_0_5.probability} isHighlighted={advancedPrediction.first_half_goals.over_0_5.probability >= 70} />
                <PredictionStatRow label="Under 1.5" value={100 - advancedPrediction.first_half_goals.over_1_5.probability} isHighlighted={100 - advancedPrediction.first_half_goals.over_1_5.probability >= 65} />
                <PredictionStatRow label="Her İki Takım Gol" value={(advancedPrediction.first_half_goals.home_team_score.probability + advancedPrediction.first_half_goals.away_team_score.probability) / 2} isHighlighted={(advancedPrediction.first_half_goals.home_team_score.probability + advancedPrediction.first_half_goals.away_team_score.probability) / 2 >= 60} />
                <PredictionStatRow label="1X İlk Yarı" value={doubleChanceStats['1X']} isHighlighted={doubleChanceStats['1X'] >= 65} />
              </div>
            </div>

            <div className="space-y-4 rounded border border-emerald-600/40 bg-emerald-950/30 p-4">
              <SectionHeading icon={<ShieldCheck className="h-4 w-4" />} title="Banko & Özel" />
              <div className="space-y-3">
                {bankoPicks.slice(0, 3).map((pick) => (
                  <div key={pick.label} className="rounded border border-emerald-400/40 bg-emerald-900/30 px-3 py-2 text-sm flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-emerald-100">{pick.label}</p>
                      <p className="text-xs text-emerald-200/70">{pick.description}</p>
                    </div>
                    <div className="text-right text-emerald-300 font-semibold">{formatProbability(pick.confidence)}</div>
                  </div>
                ))}
                {bankoPicks.length === 0 && (
                  <p className="text-xs text-emerald-200/70">Banko kriterlerine uyan ortak seçim bulunmadı.</p>
                )}
              </div>
              <Separator className="bg-emerald-800/60" />
              <div className="grid gap-3">
                <div className="text-xs uppercase text-emerald-300">Kart Tahminleri</div>
                {cardPredictions.map((stat) => (
                  <PredictionStatRow key={stat.label} label={`Kart ${stat.label}`} value={stat.value} isHighlighted={stat.value >= 70} />
                ))}
                <Separator className="bg-emerald-800/60" />
                <div className="text-xs uppercase text-emerald-300">Korner Tahminleri</div>
                {cornerPredictions.map((stat) => (
                  <PredictionStatRow key={stat.label} label={`Korner ${stat.label}`} value={stat.value} isHighlighted={stat.value >= 60} />
                ))}
              </div>
            </div>

            <div className="space-y-4 rounded border border-emerald-600/40 bg-emerald-950/30 p-4">
              <SectionHeading icon={<Goal className="h-4 w-4" />} title="Maç Sonu Tahminleri" badge={`${ourWinner.key === 'home' ? match.homeTeam.name : ourWinner.key === 'away' ? match.awayTeam.name : 'Beraberlik'} ${formatProbability(ourWinner.prob)}`} />
              <div className="grid gap-2">
                <PredictionStatRow label="Over 2.5" value={overUnder2_5.over} isHighlighted={apiSummary.overUnder === 'over' && apiSummary.overUnderLine === 2.5} />
                <PredictionStatRow label="Under 2.5" value={overUnder2_5.under} isHighlighted={apiSummary.overUnder === 'under' && apiSummary.overUnderLine === 2.5} />
                <PredictionStatRow label="BTTS Evet" value={advancedPrediction.both_teams_score.probability} isHighlighted={advancedPrediction.both_teams_score.probability >= 65} />
                <PredictionStatRow label="BTTS Hayır" value={100 - advancedPrediction.both_teams_score.probability} isHighlighted={100 - advancedPrediction.both_teams_score.probability >= 65} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card className="border border-slate-300/40 bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <ShieldCheck className="h-5 w-5 text-emerald-500" /> Banko Seçenekler
            </CardTitle>
            <CardDescription>Her iki algoritmanın ortak önerileri</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {bankoPicks.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Banko kriterlerini karşılayan ortak öneri bulunamadı.
              </p>
            ) : (
              <div className="grid gap-3">
                {bankoPicks.map((pick) => (
                  <div
                    key={pick.label}
                    className="flex items-center justify-between rounded border border-emerald-200 bg-emerald-50/60 px-4 py-3 dark:border-emerald-700 dark:bg-emerald-900/20"
                  >
                    <div>
                      <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">{pick.label}</p>
                      <p className="text-xs text-emerald-700 dark:text-emerald-300/80 mt-1">{pick.description}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-200">
                        {formatProbability(pick.confidence, 0)}
                      </div>
                      {pick.odds && (
                        <div className="text-xs text-emerald-600 dark:text-emerald-300/80">Oran {pick.odds.toFixed(2)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <BarChart2 className="h-5 w-5 text-sky-500" /> Takım Formu
            </CardTitle>
            <CardDescription>Eagle & API form verileri</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <TeamFormRow label={match.homeTeam.name} formDots={match.homeTeam.form} apiForm={apiPrediction?.comparison?.form?.home} />
            <Separator />
            <TeamFormRow label={match.awayTeam.name} formDots={match.awayTeam.form} apiForm={apiPrediction?.comparison?.form?.away} />
          </CardContent>
        </Card>
      </div>

      <Card className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <CardHeader>
          <CardTitle className="text-slate-800 dark:text-slate-100">Diğer Tahminler</CardTitle>
          <CardDescription>Algoritmaların farklı risk seviyelerindeki önerileri</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <PredictionList title="Yüksek Güven" color="bg-emerald-100 text-emerald-800" items={highConfidence} />
          <PredictionList title="Orta Risk" color="bg-amber-100 text-amber-800" items={mediumConfidence} />
          <PredictionList title="Yüksek Risk" color="bg-rose-100 text-rose-800" items={highRisk} />
        </CardContent>
      </Card>
    </div>
  );
}

interface SectionHeadingProps {
  icon?: ReactNode;
  title: string;
  badge?: string;
}

function SectionHeading({ icon, title, badge }: SectionHeadingProps) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-emerald-100">
      <div className="flex items-center gap-2 font-semibold">
        {icon}
        <span>{title}</span>
      </div>
      {badge ? (
        <span className="rounded-full border border-emerald-500/40 bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-200">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

interface PredictionStatRowProps {
  label: string;
  value: number;
  isHighlighted?: boolean;
}

function PredictionStatRow({ label, value, isHighlighted }: PredictionStatRowProps) {
  return (
    <div
      className={`flex items-center justify-between rounded border px-3 py-2 text-sm transition-colors ${
        isHighlighted
          ? "border-emerald-400/60 bg-emerald-900/40 text-emerald-100"
          : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200"
      }`}
    >
      <span>{label}</span>
      <span className="font-semibold">{value.toFixed(0)}%</span>
    </div>
  );
}

interface ProbabilityBadgeProps {
  label: string;
  value: number;
}

function ProbabilityBadge({ label, value }: ProbabilityBadgeProps) {
  return (
    <div className="text-center">
      <div className="text-xs uppercase text-emerald-300">{label}</div>
      <div className="text-lg font-semibold text-emerald-100">{formatProbability(value)}</div>
    </div>
  );
}

interface TeamFormRowProps {
  label: string;
  formDots?: string[];
  apiForm?: string;
}

function TeamFormRow({ label, formDots, apiForm }: TeamFormRowProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-800 dark:text-slate-200">{label}</span>
        {apiForm && (
          <Badge variant="secondary" className="text-xs bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200">
            API Form: {apiForm}
          </Badge>
        )}
      </div>
      {formDots && formDots.length > 0 ? (
        <div className="flex gap-2">
          {formDots.map((dot, idx) => (
            <span
              key={idx}
              className={`h-2 w-8 rounded-full ${
                dot === "win"
                  ? "bg-emerald-500"
                  : dot === "loss"
                  ? "bg-red-500"
                  : dot === "draw"
                  ? "bg-yellow-500"
                  : "bg-gray-400"
              }`}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">Form verisi mevcut değil</p>
      )}
    </div>
  );
}


function renderFormDots(form?: string[]) {
  return (
    <div className="flex gap-1">
      {(form ?? []).map((result, idx) => {
        const map: Record<string, string> = {
          win: "bg-emerald-500",
          loss: "bg-red-500",
          draw: "bg-yellow-500",
          neutral: "bg-slate-400",
        };
        return <span key={idx} className={`h-2 w-6 rounded-full ${map[result] ?? "bg-slate-500"}`} />;
      })}
    </div>
  );
}

interface SummaryTileProps {
  label: string;
  value: string;
  helper: string;
}

function SummaryTile({ label, value, helper }: SummaryTileProps) {
  return (
    <div className="rounded border border-emerald-400/40 bg-emerald-900/30 p-4">
      <div className="text-emerald-300 text-xs uppercase">{label}</div>
      <div className="text-emerald-100 text-xl font-semibold">{value}</div>
      <div className="text-emerald-200/80 text-xs mt-1">{helper}</div>
    </div>
  );
}

interface PredictionListProps {
  title: string;
  color: string;
  items: Array<{ title: string; recommendation: string; confidence: number }>;
}

function PredictionList({ title, color, items }: PredictionListProps) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h4>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">Öneri bulunamadı.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div
              key={`${item.title}-${idx}`}
              className={`rounded border px-3 py-2 text-xs font-medium ${color} bg-opacity-20 border-transparent`}
            >
              <div className="flex items-center justify-between">
                <span>{item.title}</span>
                <span>%{item.confidence}</span>
              </div>
              <div className="text-[11px] opacity-80 mt-1">{item.recommendation}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface TeamBadgeProps {
  name: string;
  logo?: string | null;
  form?: string[];
  align?: "left" | "right";
}

function TeamBadge({ name, logo, form, align = "left" }: TeamBadgeProps) {
  return (
    <div className={`flex flex-col items-${align === 'left' ? 'start' : 'end'} gap-2 text-sm`}>
      {logo ? (
        <img src={logo} alt={name} className="h-12 w-12 rounded-full border border-emerald-500/40 bg-slate-900 object-contain" />
      ) : (
        <div className="h-12 w-12 rounded-full border border-emerald-500/40 bg-slate-800 flex items-center justify-center text-sm uppercase">
          {name.slice(0, 2)}
        </div>
      )}
      {renderFormDots(form)}
      <span className="text-xs text-emerald-200/70 uppercase tracking-wide">Son form</span>
    </div>
  );
}
