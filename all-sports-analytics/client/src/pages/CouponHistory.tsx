/**
 * CouponHistory - Multi-sport saved coupons
 * Arctic Futurism UI
 *
 * - All saved coupons with filters (status, sport, date range)
 * - Stats dashboard: total coupons, win rate, total stake, return, ROI, best win
 * - Per-sport breakdown
 * - "Sonuçları Güncelle" -> refreshCouponResults()
 * - Delete individual coupons
 */
import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import {
  Loader2,
  Ticket,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  AlertTriangle,
  ChevronRight,
  BarChart3,
  RefreshCw,
  MinusCircle,
  ArrowLeft,
  DollarSign,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import {
  getSavedCoupons,
  deleteCoupon,
  refreshCouponResults,
  getCouponStats,
} from "@/lib/couponStorage";
import { useLocale } from "@/contexts/LocaleContext";
import { allSports, getSport } from "@/sports/registry";
import type { Coupon, SportId } from "@/sports/_core/types";

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

type StatusFilter = "all" | "pending" | "won" | "lost" | "partial";

export default function CouponHistory() {
  const { locale } = useLocale();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sportFilter, setSportFilter] = useState<SportId | "all">("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const labels = useMemo(() => {
    if (locale === "tr") {
      return {
        back: "Ana Panele Dön",
        title: "KUPON GEÇMİŞİ",
        subtitle: "Kaydedilen kuponların sonuçları ve performans takibi",
        refresh: "Sonuçları Güncelle",
        refreshing: "Güncelleniyor",
        filters: "Filtreler",
        all: "Tümü",
        pending: "Bekleyen",
        won: "Kazanan",
        lost: "Kaybeden",
        partial: "Kısmi",
        status: "Durum",
        sport: "Spor",
        dateFrom: "Başlangıç",
        dateTo: "Bitiş",
        allSports: "Tüm Sporlar",
        noCoupons: "Henüz kaydedilmiş kupon yok",
        noCouponsDesc: "Kupon Üretici sayfasından kupon kaydedebilirsiniz.",
        goToGenerator: "Kupon Üreticiye Git",
        totalCoupons: "Toplam Kupon",
        winRate: "Kazanma %",
        totalStake: "Toplam Yatırım",
        totalReturn: "Toplam Dönüş",
        profit: "Kar/Zarar",
        roi: "ROI",
        bestWin: "En İyi Kazanç",
        bySport: "SPOR BAZINDA PERFORMANS",
        deleteConfirm: "Bu kuponu silmek istediğinize emin misiniz?",
        delete: "Sil",
        bets: "bahis",
        unit: "birim",
        totalOddsLabel: "Toplam Oran",
        viewMatch: "Maçı Gör",
        settled: "Sonuçlandı",
        updated: "sonuçlar güncellendi",
        resultWon: "KAZANDI",
        resultLost: "KAYBETTI",
        resultVoid: "GEÇERSIZ",
        resultPending: "BEKLENIYOR",
      };
    }
    if (locale === "sv") {
      return {
        back: "Tillbaka till Dashboard",
        title: "KUPONGHISTORIK",
        subtitle: "Resultat och prestandaövervakning",
        refresh: "Uppdatera Resultat",
        refreshing: "Uppdaterar",
        filters: "Filter",
        all: "Alla",
        pending: "Väntande",
        won: "Vunna",
        lost: "Förlorade",
        partial: "Delvis",
        status: "Status",
        sport: "Sport",
        dateFrom: "Från",
        dateTo: "Till",
        allSports: "Alla Sporter",
        noCoupons: "Inga sparade kuponger ännu",
        noCouponsDesc: "Spara från kuponggeneratorn.",
        goToGenerator: "Till Kuponggeneratorn",
        totalCoupons: "Totala Kuponger",
        winRate: "Vinst %",
        totalStake: "Total Insats",
        totalReturn: "Total Återbetalning",
        profit: "Vinst/Förlust",
        roi: "ROI",
        bestWin: "Bästa Vinst",
        bySport: "PER SPORT",
        deleteConfirm: "Är du säker?",
        delete: "Radera",
        bets: "spel",
        unit: "enhet",
        totalOddsLabel: "Totala Odds",
        viewMatch: "Visa Match",
        settled: "Avgjord",
        updated: "resultat uppdaterade",
        resultWon: "VUNNEN",
        resultLost: "FÖRLORAD",
        resultVoid: "OGILTIG",
        resultPending: "VÄNTANDE",
      };
    }
    return {
      back: "Back to Dashboard",
      title: "COUPON HISTORY",
      subtitle: "Results and performance tracking for saved coupons",
      refresh: "Refresh Results",
      refreshing: "Refreshing",
      filters: "Filters",
      all: "All",
      pending: "Pending",
      won: "Won",
      lost: "Lost",
      partial: "Partial",
      status: "Status",
      sport: "Sport",
      dateFrom: "From",
      dateTo: "To",
      allSports: "All Sports",
      noCoupons: "No saved coupons yet",
      noCouponsDesc: "Save from the Coupon Generator page.",
      goToGenerator: "Go to Generator",
      totalCoupons: "Total Coupons",
      winRate: "Win Rate",
      totalStake: "Total Stake",
      totalReturn: "Total Return",
      profit: "Profit/Loss",
      roi: "ROI",
      bestWin: "Best Win",
      bySport: "BY SPORT",
      deleteConfirm: "Are you sure you want to delete this coupon?",
      delete: "Delete",
      bets: "bets",
      unit: "units",
      totalOddsLabel: "Total Odds",
      viewMatch: "View Match",
      settled: "Settled",
      updated: "results updated",
      resultWon: "WON",
      resultLost: "LOST",
      resultVoid: "VOID",
      resultPending: "PENDING",
    };
  }, [locale]);

  const loadCoupons = () => {
    setCoupons(getSavedCoupons());
  };

  useEffect(() => {
    loadCoupons();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const updated = await refreshCouponResults();
      setCoupons(updated);
      toast.success(labels.updated);
    } catch (err: any) {
      toast.error(err.message || "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const handleDelete = (id: string) => {
    if (!confirm(labels.deleteConfirm)) return;
    deleteCoupon(id);
    loadCoupons();
  };

  const stats = useMemo(() => getCouponStats(), [coupons]);

  const filteredCoupons = useMemo(() => {
    return coupons.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (sportFilter !== "all" && !c.bets.some((b) => b.sport === sportFilter))
        return false;
      if (dateFrom) {
        if (new Date(c.createdAt) < new Date(dateFrom)) return false;
      }
      if (dateTo) {
        const end = new Date(dateTo);
        end.setDate(end.getDate() + 1);
        if (new Date(c.createdAt) > end) return false;
      }
      return true;
    });
  }, [coupons, statusFilter, sportFilter, dateFrom, dateTo]);

  const sportsInHistory = useMemo(() => {
    const set = new Set<SportId>();
    coupons.forEach((c) => c.bets.forEach((b) => set.add(b.sport)));
    return Array.from(set);
  }, [coupons]);

  const dateLocale = locale === "tr" ? "tr-TR" : locale === "sv" ? "sv-SE" : "en-GB";

  const statusConfig: Record<
    string,
    { label: string; icon: any; color: string; bg: string }
  > = {
    pending: {
      label: labels.pending,
      icon: Clock,
      color: "text-warning",
      bg: "bg-warning/10 border-warning/30",
    },
    won: {
      label: labels.won,
      icon: CheckCircle2,
      color: "text-aurora",
      bg: "bg-aurora/10 border-aurora/30",
    },
    lost: {
      label: labels.lost,
      icon: XCircle,
      color: "text-destructive",
      bg: "bg-destructive/10 border-destructive/30",
    },
    partial: {
      label: labels.partial,
      icon: MinusCircle,
      color: "text-ice",
      bg: "bg-ice/10 border-ice/30",
    },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-ice" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> {labels.back}
      </Link>

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
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="font-display text-2xl sm:text-4xl font-black neon-text mb-2 tracking-wider">
                {labels.title}
              </h1>
              <p className="text-sm text-muted-foreground">{labels.subtitle}</p>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing || coupons.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-ice text-background hover:bg-ice/90 disabled:opacity-50 transition-all"
            >
              {refreshing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {labels.refreshing}
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  {labels.refresh}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      {coupons.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <StatCard
              icon={<Ticket className="w-4 h-4" />}
              label={labels.totalCoupons}
              value={stats.total.toString()}
              color="text-foreground"
            />
            <StatCard
              icon={<CheckCircle2 className="w-4 h-4" />}
              label={labels.winRate}
              value={`${stats.winRate.toFixed(1)}%`}
              color={stats.winRate >= 50 ? "text-aurora" : "text-destructive"}
            />
            <StatCard
              icon={<DollarSign className="w-4 h-4" />}
              label={labels.totalStake}
              value={stats.totalStaked.toFixed(0)}
              color="text-foreground"
            />
            <StatCard
              icon={<TrendingUp className="w-4 h-4" />}
              label={labels.totalReturn}
              value={stats.totalReturned.toFixed(0)}
              color="text-ice"
            />
            <StatCard
              icon={<DollarSign className="w-4 h-4" />}
              label={labels.profit}
              value={`${stats.profit > 0 ? "+" : ""}${stats.profit.toFixed(0)}`}
              color={
                stats.profit > 0
                  ? "text-aurora"
                  : stats.profit < 0
                  ? "text-destructive"
                  : "text-foreground"
              }
            />
            <StatCard
              icon={<BarChart3 className="w-4 h-4" />}
              label={labels.roi}
              value={`${stats.roi > 0 ? "+" : ""}${stats.roi.toFixed(1)}%`}
              color={
                stats.roi > 0
                  ? "text-aurora"
                  : stats.roi < 0
                  ? "text-destructive"
                  : "text-foreground"
              }
            />
          </div>

          {stats.bestWin && (
            <div className="glass-card rounded-xl p-4 border border-aurora/30 bg-aurora/5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
                {labels.bestWin}
              </p>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold text-sm">{stats.bestWin.strategyName}</p>
                  <p className="text-xs text-muted-foreground">
                    {stats.bestWin.bets.length} {labels.bets} •{" "}
                    {stats.bestWin.totalOdds.toFixed(2)} {labels.totalOddsLabel}
                  </p>
                </div>
                <p className="text-2xl font-display font-black neon-green font-mono">
                  +{((stats.bestWin.actualReturn || 0) - stats.bestWin.stake).toFixed(0)}{" "}
                  {labels.unit}
                </p>
              </div>
            </div>
          )}

          {/* Per-sport breakdown */}
          {Object.keys(stats.bySport).length > 0 && (
            <div className="glass-card rounded-xl p-4">
              <h3 className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-3">
                {labels.bySport}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                {Object.entries(stats.bySport).map(([sportId, data]) => {
                  const wr = data.count > 0 ? (data.won / data.count) * 100 : 0;
                  return (
                    <div
                      key={sportId}
                      className="bg-accent/30 rounded-lg p-3 flex items-center gap-2"
                    >
                      <span className="text-2xl leading-none">
                        {SPORT_ICONS[sportId as SportId]}
                      </span>
                      <div>
                        <p className="text-[10px] uppercase font-semibold tracking-wider">
                          {sportId}
                        </p>
                        <p
                          className={`text-sm font-mono font-bold ${
                            wr >= 50 ? "text-aurora" : "text-muted-foreground"
                          }`}
                        >
                          {data.won}/{data.count} ({wr.toFixed(0)}%)
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Filters */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-ice" />
          <h3 className="text-sm font-semibold">{labels.filters}</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              {labels.status}
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="mt-1 w-full bg-accent/30 rounded-lg px-3 py-2 text-sm border-0 focus:outline-none focus:ring-1 focus:ring-ice/50"
            >
              <option value="all">
                {labels.all} ({coupons.length})
              </option>
              <option value="pending">
                {labels.pending} ({coupons.filter((c) => c.status === "pending").length})
              </option>
              <option value="won">
                {labels.won} ({coupons.filter((c) => c.status === "won").length})
              </option>
              <option value="lost">
                {labels.lost} ({coupons.filter((c) => c.status === "lost").length})
              </option>
              <option value="partial">
                {labels.partial} ({coupons.filter((c) => c.status === "partial").length})
              </option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              {labels.sport}
            </label>
            <select
              value={sportFilter}
              onChange={(e) => setSportFilter(e.target.value as any)}
              className="mt-1 w-full bg-accent/30 rounded-lg px-3 py-2 text-sm border-0 focus:outline-none focus:ring-1 focus:ring-ice/50"
            >
              <option value="all">{labels.allSports}</option>
              {sportsInHistory.map((id) => {
                const plugin = (() => {
                  try {
                    return getSport(id);
                  } catch {
                    return null;
                  }
                })();
                const name =
                  plugin
                    ? locale === "tr"
                      ? plugin.config.displayNameTR
                      : plugin.config.displayName
                    : id;
                return (
                  <option key={id} value={id}>
                    {name}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              {labels.dateFrom}
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 w-full bg-accent/30 rounded-lg px-3 py-2 text-sm border-0 focus:outline-none focus:ring-1 focus:ring-ice/50 font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              {labels.dateTo}
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 w-full bg-accent/30 rounded-lg px-3 py-2 text-sm border-0 focus:outline-none focus:ring-1 focus:ring-ice/50 font-mono"
            />
          </div>
        </div>
      </div>

      {/* List */}
      {filteredCoupons.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Ticket className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="font-semibold">{labels.noCoupons}</p>
          <p className="text-xs text-muted-foreground mt-1">{labels.noCouponsDesc}</p>
          <Link
            href="/coupons"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ice text-background hover:bg-ice/90 mt-4 text-sm font-semibold"
          >
            {labels.goToGenerator} <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCoupons.map((c) => {
            const config = statusConfig[c.status as keyof typeof statusConfig] ||
              statusConfig.pending;
            const Icon = config.icon;
            const isExpanded = expanded === c.id;
            const profit = (c.actualReturn || 0) - c.stake;
            const roi = c.stake > 0 ? (profit / c.stake) * 100 : 0;

            return (
              <div
                key={c.id}
                className={`glass-card rounded-xl overflow-hidden transition-all border ${config.bg}`}
              >
                <button
                  onClick={() => setExpanded(isExpanded ? null : c.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-accent/20 transition-colors"
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${config.bg}`}
                    >
                      <Icon className={`w-5 h-5 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold truncate">{c.strategyName}</h3>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border ${config.bg} font-bold`}
                        >
                          {config.label}
                        </span>
                        {c.isMultiSport && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border border-ice/40 text-ice bg-ice/10 font-bold">
                            Multi-Sport
                          </span>
                        )}
                        <div className="flex gap-1">
                          {(c.sportsIncluded || []).slice(0, 4).map((s) => (
                            <span key={s} className="text-base leading-none">
                              {SPORT_ICONS[s]}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                        <span>
                          {c.bets.length} {labels.bets}
                        </span>
                        <span>|</span>
                        <span className="font-mono">
                          {c.totalOdds.toFixed(2)} {labels.totalOddsLabel}
                        </span>
                        <span>|</span>
                        <span>
                          {new Date(c.createdAt).toLocaleDateString(dateLocale)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <p className="text-sm font-mono font-bold text-foreground">
                      {c.stake.toFixed(0)} {labels.unit}
                    </p>
                    <p
                      className={`text-xs font-mono font-bold ${
                        profit > 0
                          ? "text-aurora"
                          : profit < 0
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {profit > 0 ? "+" : ""}
                      {profit.toFixed(0)} ({roi > 0 ? "+" : ""}
                      {roi.toFixed(0)}%)
                    </p>
                    <ChevronRight
                      className={`w-4 h-4 ml-auto mt-1 transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border/30 space-y-3">
                    <div className="space-y-2 pt-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                        {labels.bets}:
                      </p>
                      {c.bets.map((b, i) => {
                        const resultConfig: Record<string, { label: string; cls: string }> =
                          {
                            won: {
                              label: labels.resultWon,
                              cls: "bg-aurora/20 text-aurora border-aurora/40",
                            },
                            lost: {
                              label: labels.resultLost,
                              cls: "bg-destructive/20 text-destructive border-destructive/40",
                            },
                            void: {
                              label: labels.resultVoid,
                              cls: "bg-muted/20 text-muted-foreground border-muted/40",
                            },
                            pending: {
                              label: labels.resultPending,
                              cls: "bg-warning/20 text-warning border-warning/40",
                            },
                          };
                        const rc =
                          resultConfig[b.result || "pending"] || resultConfig.pending;
                        return (
                          <div
                            key={i}
                            className="flex items-center gap-3 text-xs p-2 rounded-lg bg-accent/30"
                          >
                            <span className="text-lg leading-none">
                              {SPORT_ICONS[b.sport]}
                            </span>
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
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${rc.cls}`}
                            >
                              {rc.label}
                            </span>
                            {b.actualScore && (
                              <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                                {b.actualScore.home}-{b.actualScore.away}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => handleDelete(c.id)}
                      className="w-full py-2 rounded-lg text-xs font-semibold text-destructive border border-destructive/30 hover:bg-destructive/10 transition-colors flex items-center justify-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> {labels.delete}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <span className={color}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wider font-semibold">
          {label}
        </span>
      </div>
      <p className={`text-xl font-display font-black ${color} font-mono`}>{value}</p>
    </div>
  );
}
