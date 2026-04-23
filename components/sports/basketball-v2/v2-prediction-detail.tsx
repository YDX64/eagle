'use client';

/**
 * Basketball v2 Prediction Detail Component
 *
 * Renders the full Tier 2 prediction shape from /api/basketball-v2/predictions/[gameId].
 * Shows all 8 markets (moneyline, total, handicap, team totals, quarters, halves,
 * HTFT, margin bands), all player props (DD/TD/PRA combos), and the rating
 * breakdown (ELO + Bayesian + Blended Composite + Four Factors inputs).
 */

import { useState, useEffect } from 'react';

interface V2PredictionDetailProps {
  gameId: string;
  source: 'nba' | 'basketball';
  icon: string;
  accentColor: string;
}

type TabKey = 'overview' | 'markets' | 'players' | 'ratings';

export function V2PredictionDetail({ gameId, source, icon, accentColor }: V2PredictionDetailProps) {
  const [prediction, setPrediction] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const res = await fetch(`/api/basketball-v2/predictions/${gameId}?source=${source}`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setPrediction(data.data);
        } else {
          setError(data.error || 'v2 tahmini alinamadi');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Baglanti hatasi');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [gameId, source]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-base font-semibold text-purple-700 dark:text-purple-400">
              Tier 2 Motor Calismakta
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              ELO + Bayesian + 10.000 Monte Carlo simulasyonu + oyuncu props'larinin hesaplanmasi...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6">
          <h2 className="font-bold text-red-700 dark:text-red-400 mb-2">Tier 2 Hata</h2>
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <div className="mt-4 text-xs text-gray-500">
            <p>
              <strong>Olasi nedenler:</strong> Mac warehouse'ta yok (ileri tarihli), takim
              aggregate'i hesaplanmamis, ratings henuz olusturulmamis, veya API sorunu.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!prediction) return null;

  const m = prediction.markets;
  const inp = prediction.inputs;
  const players = prediction.playerProps || [];

  const tabs: Array<{ key: TabKey; label: string; icon: string }> = [
    { key: 'overview', label: 'Genel Bakis', icon: '\uD83D\uDCCA' },
    { key: 'markets', label: 'Tum Marketler', icon: '\uD83C\uDFAF' },
    { key: 'players', label: `Oyuncular (${players.length})`, icon: '\uD83D\uDC64' },
    { key: 'ratings', label: 'Ratings & Girdiler', icon: '\uD83E\uDDE0' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Engine Banner */}
      <div className="bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 rounded-2xl p-6 text-white shadow-2xl">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider bg-white/20 px-2 py-1 rounded">
                Tier 2 Engine v2
              </span>
              <span className="text-xs font-bold uppercase tracking-wider bg-yellow-400/90 text-yellow-900 px-2 py-1 rounded">
                Bayesian + ML Ensemble
              </span>
            </div>
            <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
              <span>{icon}</span>
              {prediction.homeTeam} <span className="text-white/70 mx-2">vs</span> {prediction.awayTeam}
            </h1>
            <p className="text-sm text-white/80">
              {prediction.league} | {new Date(prediction.gameDate).toLocaleString('tr-TR')}
            </p>
          </div>
          <div className="text-right">
            <div className="text-4xl font-bold">%{(prediction.confidence * 100).toFixed(1)}</div>
            <p className="text-xs text-white/80">Tahmin Guveni</p>
            <p className="text-xs text-white/60 mt-1">
              Kazanan: <strong>{m.matchResult.predictedWinner}</strong>
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Beklenen Ev" value={inp.expectedHome.toFixed(1)} />
          <StatCard label="Beklenen Dep" value={inp.expectedAway.toFixed(1)} />
          <StatCard label="Toplam" value={m.totalPoints.expected.toFixed(1)} />
          <StatCard
            label="Spread"
            value={(inp.expectedHome - inp.expectedAway >= 0 ? '+' : '') + (inp.expectedHome - inp.expectedAway).toFixed(1)}
          />
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === tab.key
                ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg'
                : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab prediction={prediction} />}
      {activeTab === 'markets' && <MarketsTab markets={m} />}
      {activeTab === 'players' && <PlayersTab players={players} />}
      {activeTab === 'ratings' && <RatingsTab prediction={prediction} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────────────────────────────────────

function OverviewTab({ prediction }: { prediction: any }) {
  const m = prediction.markets;
  const mainTotalLine = m.totalPoints.lines.find((l: any) => Math.abs(l.line - m.totalPoints.expected) < 3) || m.totalPoints.lines[2];

  return (
    <div className="space-y-6">
      {/* Match Result */}
      <Section title="Mac Sonucu (Moneyline)" icon={'\uD83C\uDFC6'}>
        <div className="grid grid-cols-2 gap-4">
          <ProbCard
            label={prediction.homeTeam}
            subLabel="Ev Sahibi"
            probability={m.matchResult.homeWinProb}
            odds={m.matchResult.homeOdds}
            isWinner={m.matchResult.predictedWinner === prediction.homeTeam}
            color="green"
          />
          <ProbCard
            label={prediction.awayTeam}
            subLabel="Deplasman"
            probability={m.matchResult.awayWinProb}
            odds={m.matchResult.awayOdds}
            isWinner={m.matchResult.predictedWinner === prediction.awayTeam}
            color="red"
          />
        </div>
      </Section>

      {/* Quick Highlight: Total + HTFT */}
      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Toplam Sayi (Ana Cizgi)" icon={'\uD83D\uDCCA'}>
          <div className="text-center">
            <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">
              {m.totalPoints.expected.toFixed(1)}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              ± {m.totalPoints.stdDev.toFixed(1)} std dev
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Ust {mainTotalLine.line}
                </div>
                <div className="text-2xl font-bold text-green-600">
                  %{(mainTotalLine.overProb * 100).toFixed(1)}
                </div>
                <div className="text-xs text-gray-500">@ {mainTotalLine.overOdds.toFixed(2)}</div>
              </div>
              <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Alt {mainTotalLine.line}
                </div>
                <div className="text-2xl font-bold text-red-600">
                  %{(mainTotalLine.underProb * 100).toFixed(1)}
                </div>
                <div className="text-xs text-gray-500">@ {mainTotalLine.underOdds.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </Section>

        <Section title="HTFT (Ilk Yari / Tam)" icon={'\u23F1'}>
          <div className="text-center mb-3">
            <div className="text-lg font-bold text-purple-600 dark:text-purple-400">
              En Olasi: {m.htft.mostLikely.outcome}
            </div>
            <div className="text-xs text-gray-500">
              %{(m.htft.mostLikely.probability * 100).toFixed(1)} olasilik
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {(['1/1', '1/2', 'X/1', 'X/2', '2/1', '2/2'] as const).map((o) => (
              <div
                key={o}
                className={`p-2 rounded-lg text-center ${
                  o === m.htft.mostLikely.outcome
                    ? 'bg-purple-100 dark:bg-purple-900/30 border border-purple-400 font-bold'
                    : 'bg-gray-50 dark:bg-slate-700/50'
                }`}
              >
                <div className="text-xs text-gray-500">{o}</div>
                <div className="font-bold">%{(m.htft[o] * 100).toFixed(1)}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* Quarters Quick View */}
      <Section title="Ceyrek Analizi" icon={'\uD83D\uDD54'}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[m.q1, m.q2, m.q3, m.q4].map((q: any) => (
            <div
              key={q.quarter}
              className="p-3 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl border border-indigo-100 dark:border-indigo-900/30"
            >
              <div className="text-xs font-bold text-indigo-600 dark:text-indigo-400">C{q.quarter}</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {q.expectedTotal.toFixed(1)}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {q.expectedHome.toFixed(0)} - {q.expectedAway.toFixed(0)}
              </div>
              <div className="mt-2 text-[10px] text-gray-500">
                Ev %{(q.homeWinProb * 100).toFixed(0)} | Dep %{(q.awayWinProb * 100).toFixed(0)}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Margin Bands */}
      <Section title="Kazanma Farki Bantlari" icon={'\uD83D\uDCC8'}>
        <div className="space-y-2">
          {m.marginBands
            .filter((b: any) => b.probability > 0.02)
            .sort((a: any, b: any) => b.probability - a.probability)
            .map((band: any) => (
              <div key={band.label} className="flex items-center gap-3">
                <div className="text-xs font-medium text-gray-600 dark:text-gray-400 w-32 flex-shrink-0">
                  {band.label}
                </div>
                <div className="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-6 overflow-hidden relative">
                  <div
                    className="bg-gradient-to-r from-orange-500 to-red-500 h-full flex items-center justify-end pr-2"
                    style={{ width: `${Math.min(100, band.probability * 250)}%` }}
                  >
                    <span className="text-white text-xs font-bold">
                      %{(band.probability * 100).toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </Section>
    </div>
  );
}

function MarketsTab({ markets }: { markets: any }) {
  return (
    <div className="space-y-6">
      {/* Total Points Lines */}
      <Section title="Toplam Sayi - Tum Cizgiler" icon={'\uD83C\uDFAF'}>
        <LineTable lines={markets.totalPoints.lines} labelPrefix="T" />
      </Section>

      {/* Handicap Lines */}
      <Section title="Handikap / Spread" icon={'\u2696'}>
        <div className="mb-3 text-xs text-gray-500">
          Ana Cizgi: <strong>{markets.handicap.mainLine > 0 ? '+' : ''}{markets.handicap.mainLine}</strong>
          | Ev Kapatma: <strong>%{(markets.handicap.mainHomeCoverProb * 100).toFixed(1)}</strong>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-200 dark:border-slate-700">
                <th className="py-2 text-xs text-gray-500 font-medium">Cizgi</th>
                <th className="py-2 text-xs text-gray-500 font-medium">Ev %</th>
                <th className="py-2 text-xs text-gray-500 font-medium">Ev Oran</th>
                <th className="py-2 text-xs text-gray-500 font-medium">Dep %</th>
                <th className="py-2 text-xs text-gray-500 font-medium">Dep Oran</th>
              </tr>
            </thead>
            <tbody>
              {markets.handicap.alternateLines.map((h: any, i: number) => (
                <tr key={i} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="py-2 font-medium">{h.line > 0 ? '+' : ''}{h.line}</td>
                  <td className="py-2 text-green-600">%{(h.homeCoverProb * 100).toFixed(1)}</td>
                  <td className="py-2 text-gray-600">{h.homeOdds.toFixed(2)}</td>
                  <td className="py-2 text-red-600">%{(h.awayCoverProb * 100).toFixed(1)}</td>
                  <td className="py-2 text-gray-600">{h.awayOdds.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Team Totals */}
      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Ev Sahibi Takim Toplami" icon={'\uD83C\uDFE0'}>
          <div className="text-center mb-3">
            <div className="text-3xl font-bold text-green-600">{markets.teamTotals.home.expected.toFixed(1)}</div>
          </div>
          <LineTable lines={markets.teamTotals.home.lines} labelPrefix="T" compact />
        </Section>
        <Section title="Deplasman Takim Toplami" icon={'\u2708'}>
          <div className="text-center mb-3">
            <div className="text-3xl font-bold text-red-600">{markets.teamTotals.away.expected.toFixed(1)}</div>
          </div>
          <LineTable lines={markets.teamTotals.away.lines} labelPrefix="T" compact />
        </Section>
      </div>

      {/* Quarters */}
      <Section title="Ceyrek Detaylari" icon={'\uD83D\uDD52'}>
        <div className="grid md:grid-cols-2 gap-4">
          {[markets.q1, markets.q2, markets.q3, markets.q4].map((q: any) => (
            <QuarterCard key={q.quarter} quarter={q} />
          ))}
        </div>
      </Section>

      {/* Halves */}
      <Section title="Yari Devre / Ikinci Yari" icon={'\uD83D\uDD70'}>
        <div className="grid md:grid-cols-2 gap-4">
          <HalfCard half={markets.firstHalf} title="Ilk Yari" />
          <HalfCard half={markets.secondHalf} title="Ikinci Yari" />
        </div>
      </Section>

      {/* HTFT Matrix */}
      <Section title="HTFT Matrisi (6 Olasilik)" icon={'\uD83D\uDD04'}>
        <div className="grid grid-cols-3 gap-3">
          {(['1/1', '1/2', 'X/1', 'X/2', '2/1', '2/2'] as const).map((o) => {
            const prob = markets.htft[o];
            const isTop = o === markets.htft.mostLikely.outcome;
            return (
              <div
                key={o}
                className={`p-4 rounded-xl text-center ${
                  isTop
                    ? 'bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-lg'
                    : 'bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700'
                }`}
              >
                <div className={`text-xs uppercase ${isTop ? 'text-white/80' : 'text-gray-500'}`}>{o}</div>
                <div className={`text-3xl font-bold mt-1 ${isTop ? 'text-white' : 'text-gray-900 dark:text-white'}`}>
                  %{(prob * 100).toFixed(1)}
                </div>
                <div className={`text-xs mt-1 ${isTop ? 'text-white/70' : 'text-gray-400'}`}>
                  @ {(1 / Math.max(0.01, prob)).toFixed(2)}
                </div>
                {isTop && (
                  <div className="text-[10px] text-white/90 uppercase font-bold mt-2">En Olasi</div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* Odd/Even */}
      <Section title="Tek / Cift Toplam" icon={'\uD83C\uDFB2'}>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-center">
            <div className="text-xs text-gray-500 uppercase">Tek</div>
            <div className="text-3xl font-bold text-blue-600">%{(markets.totalPoints.oddProb * 100).toFixed(1)}</div>
            <div className="text-xs text-gray-500 mt-1">@ {(1 / markets.totalPoints.oddProb).toFixed(2)}</div>
          </div>
          <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-xl text-center">
            <div className="text-xs text-gray-500 uppercase">Cift</div>
            <div className="text-3xl font-bold text-orange-600">%{(markets.totalPoints.evenProb * 100).toFixed(1)}</div>
            <div className="text-xs text-gray-500 mt-1">@ {(1 / markets.totalPoints.evenProb).toFixed(2)}</div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function PlayersTab({ players }: { players: any[] }) {
  if (players.length === 0) {
    return (
      <Section title="Oyuncu Tahminleri" icon={'\uD83D\uDC64'}>
        <p className="text-sm text-gray-500 text-center py-8">
          Bu oyun icin oyuncu prop tahminleri yok.
          <br />
          <span className="text-xs">(Sadece NBA kaynakli mac'lar icin mevcuttur)</span>
        </p>
      </Section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-3 text-xs text-yellow-800 dark:text-yellow-300">
        <strong>Double-Double / Triple-Double</strong> olasiliklari <strong>5.000 multivariate Monte Carlo</strong>
        ornekleme ile hesaplandi. Stat'lar arasindaki korelasyonlar (pts-reb ~0.20, pts-ast ~0.30) empirik olarak kullanildi.
      </div>
      {players.map((p) => (
        <PlayerCard key={p.playerId} player={p} />
      ))}
    </div>
  );
}

function RatingsTab({ prediction }: { prediction: any }) {
  const inp = prediction.inputs;
  return (
    <div className="space-y-6">
      {/* Ratings Comparison */}
      <Section title="Takim Ratingleri (3 Yontem)" icon={'\uD83E\uDDE0'}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b-2 border-gray-200 dark:border-slate-700">
                <th className="py-3 text-xs text-gray-500 font-medium">Yontem</th>
                <th className="py-3 text-xs text-gray-500 font-medium">Ev</th>
                <th className="py-3 text-xs text-gray-500 font-medium">Dep</th>
                <th className="py-3 text-xs text-gray-500 font-medium">Fark</th>
              </tr>
            </thead>
            <tbody>
              <RatingRow
                label="ELO"
                sub="FiveThirtyEight K=20"
                home={inp.homeEloComposite}
                away={inp.awayEloComposite}
              />
              <RatingRow
                label="Bayesian"
                sub="Conjugate Normal-Normal"
                home={inp.homeBayesianComposite}
                away={inp.awayBayesianComposite}
              />
              <RatingRow
                label="Blended"
                sub="50% Bayes + 35% ELO + 15% Massey"
                home={inp.homeBlendedComposite}
                away={inp.awayBlendedComposite}
                bold
              />
            </tbody>
          </table>
        </div>
      </Section>

      {/* Form & Momentum */}
      <Section title="Form Analizi (Son 10 Mac)" icon={'\uD83D\uDD25'}>
        <div className="grid md:grid-cols-2 gap-4">
          <FormCard title="Ev Sahibi" form={inp.homeForm} />
          <FormCard title="Deplasman" form={inp.awayForm} />
        </div>
      </Section>

      {/* Rest & HCA */}
      <Section title="Dinlenme / Ev Sahibi Avantaji" icon={'\uD83D\uDECB'}>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-xl">
            <div className="text-xs text-gray-500 uppercase mb-1">Ev Dinlenme</div>
            <div className="text-2xl font-bold text-green-600">
              {inp.homeRestDays === null ? '?' : `${inp.homeRestDays} gun`}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Etki: {inp.homeRestAdj > 0 ? '+' : ''}{inp.homeRestAdj} pt
            </div>
          </div>
          <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl">
            <div className="text-xs text-gray-500 uppercase mb-1">Dep Dinlenme</div>
            <div className="text-2xl font-bold text-red-600">
              {inp.awayRestDays === null ? '?' : `${inp.awayRestDays} gun`}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Etki: {inp.awayRestAdj > 0 ? '+' : ''}{inp.awayRestAdj} pt
            </div>
          </div>
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
            <div className="text-xs text-gray-500 uppercase mb-1">Ev Sahibi Avantaji</div>
            <div className="text-2xl font-bold text-blue-600">+{inp.homeHca.toFixed(1)} pt</div>
            <div className="text-xs text-gray-500 mt-1">Blended (team + league)</div>
          </div>
        </div>
      </Section>

      {/* Raw Projection */}
      <Section title="Ham Projeksiyon" icon={'\uD83D\uDCD0'}>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="p-4 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 rounded-xl">
            <div className="text-xs text-gray-500 uppercase mb-2">Ev Sahibi Beklenen</div>
            <div className="text-4xl font-bold text-emerald-600">{inp.expectedHome.toFixed(1)}</div>
            <div className="text-xs text-gray-500 mt-2">
              ± {inp.homeStdDev} std dev | Pace-adjusted ORtg vs Dep DRtg
            </div>
          </div>
          <div className="p-4 bg-gradient-to-br from-rose-50 to-pink-50 dark:from-rose-900/20 dark:to-pink-900/20 rounded-xl">
            <div className="text-xs text-gray-500 uppercase mb-2">Deplasman Beklenen</div>
            <div className="text-4xl font-bold text-rose-600">{inp.expectedAway.toFixed(1)}</div>
            <div className="text-xs text-gray-500 mt-2">
              ± {inp.awayStdDev} std dev | Pace-adjusted ORtg vs Ev DRtg
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white/10 backdrop-blur rounded-lg p-3 text-center">
      <div className="text-xs text-white/70 uppercase">{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-md border border-gray-100 dark:border-slate-700 p-5">
      <h3 className="font-bold text-base mb-4 text-gray-900 dark:text-white flex items-center gap-2">
        <span>{icon}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

function ProbCard({
  label,
  subLabel,
  probability,
  odds,
  isWinner,
  color,
}: {
  label: string;
  subLabel: string;
  probability: number;
  odds: number;
  isWinner: boolean;
  color: 'green' | 'red';
}) {
  const colors = {
    green: 'from-green-500 to-emerald-600',
    red: 'from-red-500 to-rose-600',
  };
  return (
    <div
      className={`p-5 rounded-xl text-center ${
        isWinner
          ? `bg-gradient-to-br ${colors[color]} text-white shadow-xl`
          : 'bg-gray-50 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-600'
      }`}
    >
      <div className={`text-xs uppercase font-bold ${isWinner ? 'text-white/80' : 'text-gray-500'}`}>{subLabel}</div>
      <div className={`text-sm font-bold mt-1 ${isWinner ? 'text-white' : 'text-gray-900 dark:text-white'} truncate`}>
        {label}
      </div>
      <div className={`text-4xl font-bold my-2 ${isWinner ? 'text-white' : 'text-gray-900 dark:text-white'}`}>
        %{(probability * 100).toFixed(1)}
      </div>
      <div className={`text-xs ${isWinner ? 'text-white/70' : 'text-gray-500'}`}>@ {odds.toFixed(2)}</div>
      {isWinner && <div className="text-[10px] text-white/90 uppercase font-bold mt-2">TAHMIN</div>}
    </div>
  );
}

function LineTable({ lines, labelPrefix, compact }: { lines: any[]; labelPrefix: string; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-gray-200 dark:border-slate-700">
            <th className="py-2 text-xs text-gray-500 font-medium">Cizgi</th>
            <th className="py-2 text-xs text-gray-500 font-medium">Ust %</th>
            {!compact && <th className="py-2 text-xs text-gray-500 font-medium">Ust Oran</th>}
            <th className="py-2 text-xs text-gray-500 font-medium">Alt %</th>
            {!compact && <th className="py-2 text-xs text-gray-500 font-medium">Alt Oran</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((line: any, i: number) => (
            <tr key={i} className="border-b border-gray-100 dark:border-slate-800">
              <td className="py-2 font-medium">
                {labelPrefix} {line.line}
              </td>
              <td className="py-2 text-green-600">%{(line.overProb * 100).toFixed(1)}</td>
              {!compact && <td className="py-2 text-gray-600">{line.overOdds.toFixed(2)}</td>}
              <td className="py-2 text-red-600">%{(line.underProb * 100).toFixed(1)}</td>
              {!compact && <td className="py-2 text-gray-600">{line.underOdds.toFixed(2)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuarterCard({ quarter }: { quarter: any }) {
  return (
    <div className="p-4 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold text-indigo-700 dark:text-indigo-400">Ceyrek {quarter.quarter}</div>
        <div className="text-2xl font-bold text-gray-900 dark:text-white">{quarter.expectedTotal.toFixed(1)}</div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs mb-3">
        <div className="text-center">
          <div className="text-gray-500">Ev</div>
          <div className="font-bold">{quarter.expectedHome.toFixed(1)}</div>
        </div>
        <div className="text-center">
          <div className="text-gray-500">Dep</div>
          <div className="font-bold">{quarter.expectedAway.toFixed(1)}</div>
        </div>
        <div className="text-center">
          <div className="text-gray-500">Toplam</div>
          <div className="font-bold">{quarter.expectedTotal.toFixed(1)}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 text-[10px]">
        <div className="text-center p-1 bg-white dark:bg-slate-700 rounded">
          <div className="text-gray-500">Ev %</div>
          <div className="font-bold text-green-600">{(quarter.homeWinProb * 100).toFixed(0)}</div>
        </div>
        <div className="text-center p-1 bg-white dark:bg-slate-700 rounded">
          <div className="text-gray-500">Bera %</div>
          <div className="font-bold text-gray-600">{(quarter.drawProb * 100).toFixed(0)}</div>
        </div>
        <div className="text-center p-1 bg-white dark:bg-slate-700 rounded">
          <div className="text-gray-500">Dep %</div>
          <div className="font-bold text-red-600">{(quarter.awayWinProb * 100).toFixed(0)}</div>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-gray-500">
        <span className="mr-2">Tek %{(quarter.oddProb * 100).toFixed(0)}</span>
        <span>Cift %{(quarter.evenProb * 100).toFixed(0)}</span>
      </div>
    </div>
  );
}

function HalfCard({ half, title }: { half: any; title: string }) {
  return (
    <div className="p-4 bg-gradient-to-br from-teal-50 to-cyan-50 dark:from-teal-900/20 dark:to-cyan-900/20 rounded-xl border border-teal-100 dark:border-teal-900/30">
      <div className="text-sm font-bold text-teal-700 dark:text-teal-400 mb-2">{title}</div>
      <div className="text-3xl font-bold text-gray-900 dark:text-white">{half.expectedTotal.toFixed(1)}</div>
      <div className="text-xs text-gray-500 mt-1">
        {half.expectedHome.toFixed(1)} - {half.expectedAway.toFixed(1)}
      </div>
      <div className="mt-3 flex gap-2 text-xs">
        <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
          Ev %{(half.homeWinProb * 100).toFixed(0)}
        </span>
        <span className="px-2 py-1 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded">
          Bera %{(half.drawProb * 100).toFixed(0)}
        </span>
        <span className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded">
          Dep %{(half.awayWinProb * 100).toFixed(0)}
        </span>
      </div>
    </div>
  );
}

function PlayerCard({ player }: { player: any }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white">{player.name}</h4>
          <p className="text-xs text-gray-500">
            {player.team} | {player.gamesPlayed} mac | {player.mpg.toFixed(1)} dak/mac
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">PRA</div>
          <div className="text-xl font-bold text-purple-600">{player.combos.praProjected.toFixed(1)}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3 text-sm">
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center">
          <div className="text-xs text-gray-500">Sayi</div>
          <div className="font-bold text-blue-600">{player.projected.points.toFixed(1)}</div>
        </div>
        <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
          <div className="text-xs text-gray-500">Ribaund</div>
          <div className="font-bold text-green-600">{player.projected.rebounds.toFixed(1)}</div>
        </div>
        <div className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg text-center">
          <div className="text-xs text-gray-500">Asist</div>
          <div className="font-bold text-orange-600">{player.projected.assists.toFixed(1)}</div>
        </div>
      </div>

      {/* DD/TD combo probs */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
          <div className="text-xs text-gray-500">Double-Double</div>
          <div className="text-lg font-bold text-yellow-600">
            %{(player.combos.doubleDoubleProb * 100).toFixed(1)}
          </div>
        </div>
        <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
          <div className="text-xs text-gray-500">Triple-Double</div>
          <div className="text-lg font-bold text-purple-600">
            %{(player.combos.tripleDoubleProb * 100).toFixed(2)}
          </div>
        </div>
      </div>

      {/* Points lines */}
      {player.props.points && player.props.points.length > 0 && (
        <div className="text-xs">
          <div className="text-gray-500 mb-1">Sayi Ust/Alt:</div>
          <div className="flex gap-1 flex-wrap">
            {player.props.points.map((line: any, i: number) => (
              <span
                key={i}
                className={`px-2 py-1 rounded text-[10px] ${
                  line.overProb > 0.55
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : line.overProb < 0.45
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                {line.line}: {(line.overProb * 100).toFixed(0)}/{(line.underProb * 100).toFixed(0)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RatingRow({
  label,
  sub,
  home,
  away,
  bold,
}: {
  label: string;
  sub: string;
  home: number | null;
  away: number | null;
  bold?: boolean;
}) {
  const diff = home !== null && away !== null ? home - away : null;
  return (
    <tr className={`border-b border-gray-100 dark:border-slate-800 ${bold ? 'bg-purple-50/50 dark:bg-purple-900/10' : ''}`}>
      <td className="py-3">
        <div className={`${bold ? 'font-bold' : 'font-medium'} text-gray-900 dark:text-white`}>{label}</div>
        <div className="text-xs text-gray-500">{sub}</div>
      </td>
      <td className="py-3 font-mono">{home !== null ? home.toFixed(2) : '—'}</td>
      <td className="py-3 font-mono">{away !== null ? away.toFixed(2) : '—'}</td>
      <td className={`py-3 font-mono font-bold ${diff && diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
        {diff !== null ? (diff > 0 ? '+' : '') + diff.toFixed(2) : '—'}
      </td>
    </tr>
  );
}

function FormCard({ title, form }: { title: string; form: any }) {
  return (
    <div className="p-4 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-xl border border-amber-100 dark:border-amber-900/30">
      <div className="text-sm font-bold text-amber-700 dark:text-amber-400 mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-xs text-gray-500">Kazanma</div>
          <div className="text-xl font-bold">
            {form.wins}-{form.losses}
          </div>
          <div className="text-xs text-gray-500">Son {form.lastGames}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Form Skoru</div>
          <div className="text-xl font-bold text-amber-600">
            {(form.weightedFormScore * 100).toFixed(0)}
          </div>
          <div className="text-xs text-gray-500">(0-100)</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-gray-500">Sayi</div>
          <div className="font-bold">{form.avgPointsFor.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-gray-500">Yenen</div>
          <div className="font-bold">{form.avgPointsAgainst.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-gray-500">Marj</div>
          <div className={`font-bold ${form.avgMargin > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {form.avgMargin > 0 ? '+' : ''}
            {form.avgMargin.toFixed(1)}
          </div>
        </div>
      </div>
      <div className="mt-2 text-xs">
        <span className="text-gray-500">Serisi:</span>{' '}
        <span className="font-bold">{form.currentStreak}</span>
      </div>
    </div>
  );
}
