/**
 * Coupon History Page - Kaydedilen Kuponlar & Sonuçlar
 * Arctic Futurism Theme - AWA Stats
 * i18n destekli - Türkçe, İsveççe, İngilizce
 * Kupon geçmişi, kazanç/kayıp takibi, istatistikler
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
import {
  getGames,
  getTodayDate,
  isFinishedGame,
  formatDate,
  type Game,
} from "@/lib/api";
import {
  getSavedCoupons,
  updateCouponResults,
  deleteCoupon,
  getCouponStats,
  type SavedCoupon,
} from "@/lib/couponStore";
import {
  Loader2,
  Ticket,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ChevronRight,
  DollarSign,
  BarChart3,
  RefreshCw,
  MinusCircle,
  ArrowLeft,
} from "lucide-react";

const HERO_BG = "https://d2xsxph8kpxj0f.cloudfront.net/113104593/XD6sTiRUS9vW5Ribu2FZ4U/hero-banner-cAvoYmzafSTHSonnd88HXv.webp";

export default function CouponHistory() {
  const { t } = useLocale();
  const [coupons, setCoupons] = useState<SavedCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'won' | 'lost' | 'partial'>('all');
  const [expandedCoupon, setExpandedCoupon] = useState<string | null>(null);

  useEffect(() => {
    const loadAndUpdate = async () => {
      setLoading(true);
      try {
        const today = getTodayDate();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        const [todayRes, yesterdayRes] = await Promise.allSettled([
          getGames({ date: today }),
          getGames({ date: yesterdayStr }),
        ]);

        const allGames: Game[] = [];
        if (todayRes.status === 'fulfilled') {
          allGames.push(...(todayRes.value.response || []).filter(g => isFinishedGame(g.status)));
        }
        if (yesterdayRes.status === 'fulfilled') {
          allGames.push(...(yesterdayRes.value.response || []).filter(g => isFinishedGame(g.status)));
        }

        const updated = updateCouponResults(allGames);
        setCoupons(updated);
      } catch {
        setCoupons(getSavedCoupons());
      } finally {
        setLoading(false);
      }
    };
    loadAndUpdate();
  }, []);

  const stats = getCouponStats();

  const filteredCoupons = filter === 'all' ? coupons : coupons.filter(c => c.status === filter);

  const handleDelete = (id: string) => {
    if (confirm(t('history_delete_confirm'))) {
      deleteCoupon(id);
      setCoupons(prev => prev.filter(c => c.id !== id));
    }
  };

  const statusConfig = {
    pending: { label: t('history_pending'), icon: Clock, color: 'text-warning', bg: 'bg-warning/10 border-warning/30' },
    won: { label: t('history_won'), icon: CheckCircle2, color: 'text-aurora', bg: 'bg-aurora/10 border-aurora/30' },
    lost: { label: t('history_lost'), icon: XCircle, color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30' },
    partial: { label: t('history_partial'), icon: MinusCircle, color: 'text-ice', bg: 'bg-ice/10 border-ice/30' },
    void: { label: t('result_void'), icon: MinusCircle, color: 'text-muted-foreground', bg: 'bg-muted/10 border-muted/30' },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-ice" />
        <span className="ml-3 text-muted-foreground">{t('common_loading')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> {t('match_back')}
      </Link>

      {/* Hero */}
      <div className="relative rounded-xl overflow-hidden p-8 sm:p-12" style={{ backgroundImage: `url(${HERO_BG})`, backgroundSize: "cover", backgroundPosition: "center" }}>
        <div className="absolute inset-0 bg-background/85 backdrop-blur-sm" />
        <div className="relative z-10">
          <h1 className="font-display text-3xl sm:text-4xl font-black neon-text mb-2">{t('history_title')}</h1>
          <p className="text-sm text-muted-foreground">{t('history_subtitle')}</p>
        </div>
      </div>

      {/* Stats Summary */}
      {coupons.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="glass-card rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Ticket className="w-3.5 h-3.5" /> {t('history_total_stake')}
            </p>
            <p className="text-2xl font-display font-black text-foreground">{stats.totalStaked.toFixed(0)}</p>
          </div>
          <div className="glass-card rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5" /> {t('history_total_return')}
            </p>
            <p className="text-2xl font-display font-black text-ice">{stats.totalReturned.toFixed(0)}</p>
          </div>
          <div className="glass-card rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" /> {t('history_profit')}
            </p>
            <p className={`text-2xl font-display font-black ${stats.profit > 0 ? 'text-aurora' : stats.profit < 0 ? 'text-destructive' : 'text-foreground'}`}>
              {stats.profit > 0 ? '+' : ''}{stats.profit.toFixed(0)}
            </p>
          </div>
          <div className="glass-card rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <BarChart3 className="w-3.5 h-3.5" /> {t('history_roi')}
            </p>
            <p className={`text-2xl font-display font-black ${stats.roi > 0 ? 'text-aurora' : stats.roi < 0 ? 'text-destructive' : 'text-foreground'}`}>
              {stats.roi > 0 ? '+' : ''}{stats.roi.toFixed(1)}%
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'all' as const, label: `${t('history_all')} (${coupons.length})` },
          { id: 'pending' as const, label: `${t('history_pending')} (${coupons.filter(c => c.status === 'pending').length})` },
          { id: 'won' as const, label: `${t('history_won')} (${coupons.filter(c => c.status === 'won').length})` },
          { id: 'lost' as const, label: `${t('history_lost')} (${coupons.filter(c => c.status === 'lost').length})` },
          { id: 'partial' as const, label: `${t('history_partial')} (${coupons.filter(c => c.status === 'partial').length})` },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === f.id ? "glass-card neon-border text-ice" : "text-muted-foreground hover:bg-accent/30"
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Coupons List */}
      {filteredCoupons.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Ticket className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="font-semibold text-foreground">{t('history_no_coupons')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('history_no_coupons_desc')}</p>
          <Link href="/coupons" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ice text-background hover:bg-ice/90 transition-colors mt-4 text-sm font-semibold">
            {t('history_go_coupons')} <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCoupons.map((coupon) => {
            const config = statusConfig[coupon.status as keyof typeof statusConfig];
            const Icon = config.icon;
            const isExpanded = expandedCoupon === coupon.id;
            const profit = (coupon.actualReturn || 0) - coupon.stake;
            const roi = coupon.stake > 0 ? ((profit / coupon.stake) * 100) : 0;

            return (
              <div key={coupon.id} className={`glass-card rounded-xl overflow-hidden transition-all border ${config.bg}`}>
                <button onClick={() => setExpandedCoupon(isExpanded ? null : coupon.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-accent/20 transition-colors">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${config.bg}`}>
                      <Icon className={`w-5 h-5 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{coupon.strategyName}</h3>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${config.bg} font-bold`}>
                          {config.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                        <span>{coupon.bets.length} {t('coupons_bets')}</span>
                        <span>|</span>
                        <span className="font-mono">{coupon.totalOdds.toFixed(2)} {t('common_odds')}</span>
                        <span>|</span>
                        <span>{formatDate(coupon.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <div className="flex items-center gap-2">
                      <div>
                        <p className="text-sm font-mono font-bold text-foreground">{coupon.stake.toFixed(0)} {t('coupons_unit')}</p>
                        <p className={`text-xs font-mono font-bold ${profit > 0 ? 'text-aurora' : profit < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {profit > 0 ? '+' : ''}{profit.toFixed(0)} ({roi > 0 ? '+' : ''}{roi.toFixed(0)}%)
                        </p>
                      </div>
                      <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border/30 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3">
                      <div>
                        <p className="text-[10px] text-muted-foreground">{t('coupons_suggested_stake')}</p>
                        <p className="text-sm font-mono font-bold">{coupon.stake.toFixed(0)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">{t('coupons_potential_return')}</p>
                        <p className="text-sm font-mono font-bold text-ice">{(coupon.stake * coupon.totalOdds).toFixed(0)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">{t('history_total_return')}</p>
                        <p className="text-sm font-mono font-bold text-aurora">{(coupon.actualReturn || 0).toFixed(0)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">{t('history_profit')}</p>
                        <p className={`text-sm font-mono font-bold ${profit > 0 ? 'text-aurora' : profit < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {profit > 0 ? '+' : ''}{profit.toFixed(0)}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2 pt-2">
                      <p className="text-xs font-semibold text-muted-foreground">{t('coupons_bets')}:</p>
                      {coupon.bets.map((bet, i) => (
                        <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-accent/30">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold">{bet.homeTeam} {t('common_vs')} {bet.awayTeam}</p>
                            <p className="text-muted-foreground">{bet.betType}: {bet.selection}</p>
                          </div>
                          <div className="text-right shrink-0 ml-2">
                            <p className="font-mono font-bold text-ice">{bet.odds.toFixed(2)}</p>
                            <p className="text-muted-foreground">{bet.result === 'won' ? t('result_won') : bet.result === 'lost' ? t('result_lost') : t('result_pending')}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <button onClick={() => handleDelete(coupon.id)}
                      className="w-full py-2 rounded-lg text-xs font-semibold text-destructive border border-destructive/30 hover:bg-destructive/10 transition-colors flex items-center justify-center gap-2">
                      <Trash2 className="w-3.5 h-3.5" /> {t('history_delete')}
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
