'use client';

import { useState } from 'react';
import type { EnhancedPredictionResult } from '@/lib/enhanced-prediction-engine';

/**
 * Velocity Glass Prediction View
 *
 * Pixel-perfect implementation of stitch2 (mobile) + stitch3 (desktop).
 * Two source tabs: "Algoritmamız" (our engines) and "API Football" (external).
 */

interface Props { data: EnhancedPredictionResult }

/* ── helpers ── */
function FormDot({ r }: { r: string }) {
  return <span className={`w-2 h-2 rounded-full ${r === 'W' ? 'bg-secondary' : r === 'L' ? 'bg-error' : 'bg-outline'}`} />;
}

function ProbBar({ value, color = 'secondary' }: { value: number; color?: string }) {
  const cls: Record<string, string> = {
    secondary: 'bg-secondary shadow-[0_0_10px_#2ff801]',
    primary: 'bg-primary shadow-[0_0_10px_rgba(161,250,255,0.5)]',
    error: 'bg-error',
    tertiary: 'bg-tertiary',
  };
  return (
    <div className="prob-bar overflow-hidden">
      <div className={`h-full rounded-full ${cls[color] || cls.secondary}`} style={{ width: `${Math.min(100, value)}%`, opacity: value > 70 ? 1 : 0.8 }} />
    </div>
  );
}

function valColor(v: number) {
  if (v >= 75) return 'text-secondary text-glow-secondary';
  if (v >= 55) return 'text-primary';
  if (v >= 40) return 'text-tertiary';
  return 'text-error';
}

function barColor(v: number) {
  if (v >= 75) return 'secondary';
  if (v >= 55) return 'primary';
  if (v >= 40) return 'tertiary';
  return 'error';
}

export default function VelocityGlassPrediction({ data }: Props) {
  const [tab, setTab] = useState<'fulltime' | 'halftime' | 'banker' | 'cards'>('fulltime');
  const [source, setSource] = useState<'ours' | 'api'>('ours');

  const { match, prediction: p, cards, corners, odds, ensemble: e, form, api_predictions: api } = data;

  /* API Football'dan gelen predictions varsa */
  const apiP = api?.predictions;
  const apiTeams = api?.teams;
  const apiH2H = api?.h2h;

  const tabs = [
    { id: 'fulltime' as const, label: 'Full Time', icon: 'timer' },
    { id: 'halftime' as const, label: 'Half Time', icon: 'shutter_speed' },
    { id: 'banker' as const, label: 'Banker', icon: 'verified' },
    { id: 'cards' as const, label: 'Cards', icon: 'style' },
  ];

  return (
    <div className="min-h-screen bg-background text-on-surface font-body">
      {/* Mesh gradient */}
      <div className="mesh-gradient" />

      {/* ═══ MOBILE HEADER (stitch2) ═══ */}
      <header className="fixed top-0 w-full z-50 bg-transparent backdrop-blur-xl flex justify-between items-center px-6 py-4 lg:hidden">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-primary cursor-pointer" onClick={() => window.history.back()}>arrow_back</span>
          <h1 className="font-headline uppercase tracking-widest text-xs font-bold text-primary">
            {match.league.country.toUpperCase()} {match.league.name.toUpperCase()} • {match.time}
          </h1>
        </div>
        <span className="material-symbols-outlined text-primary">sensors</span>
      </header>

      {/* ═══ DESKTOP HEADER (stitch3) ═══ */}
      <header className="hidden lg:flex fixed top-0 w-full z-50 justify-between items-center px-8 h-20 bg-slate-950/60 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,245,255,0.1)]">
        <div className="flex items-center gap-12">
          <h1 className="text-2xl font-bold italic text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-cyan-600 font-headline tracking-tight cursor-pointer" onClick={() => window.location.href = '/'}>Velocity Glass</h1>
          <nav className="flex gap-8 items-center">
            <a className="text-cyan-400 border-b-2 border-cyan-400 pb-1 font-label text-sm uppercase tracking-wider" href="/">Live</a>
            <a className="text-slate-400 hover:text-cyan-200 transition-colors font-label text-sm uppercase tracking-wider" href="/">Schedule</a>
            <a className="text-slate-400 hover:text-cyan-200 transition-colors font-label text-sm uppercase tracking-wider" href="/">Markets</a>
            <a className="text-slate-400 hover:text-cyan-200 transition-colors font-label text-sm uppercase tracking-wider" href="/">Insights</a>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
            <input className="bg-surface-container-highest border-none rounded-full py-2 pl-10 pr-4 text-sm focus:ring-1 focus:ring-primary w-64 transition-all" placeholder="Search matches..." />
          </div>
          <button className="p-2 hover:bg-cyan-400/10 rounded-full transition-colors"><span className="material-symbols-outlined text-on-surface-variant">notifications</span></button>
        </div>
      </header>

      {/* ═══ MOBILE LAYOUT ═══ */}
      <main className="pt-24 pb-32 px-4 space-y-4 max-w-md mx-auto lg:hidden">

        {/* Match Card (stitch2 exact) */}
        <section className="glass-panel rounded-3xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 blur-[60px]" />
          <div className="flex justify-between items-center relative z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-16 h-16 bg-surface-container rounded-2xl flex items-center justify-center p-2">
                <img src={match.home_team.logo} alt={match.home_team.name} className="w-10 opacity-80" />
              </div>
              <span className="font-headline font-bold text-sm tracking-tight">{match.home_team.name.toUpperCase()}</span>
              <div className="flex gap-1">{form.home.last_5.split('').map((r, i) => <FormDot key={i} r={r} />)}</div>
              <span className="font-label text-[10px] text-on-surface-variant">{form.home.position > 0 ? `${form.home.position}. Sıra` : ''}</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="font-headline text-4xl font-black text-primary text-glow-primary">VS</div>
              <div className="bg-primary/20 text-primary px-3 py-1 rounded-full text-[10px] font-bold mt-2 font-label uppercase tracking-widest">{match.status.short === 'NS' ? 'Live Soon' : match.status.long}</div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-16 h-16 bg-surface-container rounded-2xl flex items-center justify-center p-2">
                <img src={match.away_team.logo} alt={match.away_team.name} className="w-10 opacity-80" />
              </div>
              <span className="font-headline font-bold text-sm tracking-tight">{match.away_team.name.toUpperCase()}</span>
              <div className="flex gap-1">{form.away.last_5.split('').map((r, i) => <FormDot key={i} r={r} />)}</div>
              <span className="font-label text-[10px] text-on-surface-variant">{form.away.position > 0 ? `${form.away.position}. Sıra` : ''}</span>
            </div>
          </div>
        </section>

        {/* Source Toggle: Algoritmamız / API Football */}
        <div className="flex rounded-2xl bg-surface-container-high p-1 gap-1">
          <button onClick={() => setSource('ours')} className={`flex-1 py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-wider transition-all ${source === 'ours' ? 'bg-secondary/15 text-secondary shadow-[0_0_12px_rgba(47,248,1,0.15)]' : 'text-outline hover:text-on-surface-variant'}`}>
            <span className="material-symbols-outlined text-xs mr-1 align-middle">psychology</span> Algoritmamız
          </button>
          <button onClick={() => setSource('api')} className={`flex-1 py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-wider transition-all ${source === 'api' ? 'bg-primary/15 text-primary shadow-[0_0_12px_rgba(161,250,255,0.15)]' : 'text-outline hover:text-on-surface-variant'}`}>
            <span className="material-symbols-outlined text-xs mr-1 align-middle">api</span> API Football
          </button>
        </div>

        {/* Tab Switcher (stitch2 exact) */}
        <nav className="flex space-x-2 overflow-x-auto pb-2 no-scrollbar">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-3 rounded-lg whitespace-nowrap transition-all ${tab === t.id ? 'text-secondary bg-secondary/5 border-l-4 border-secondary' : 'text-slate-400 hover:bg-white/5'}`}>
              <span className="material-symbols-outlined text-sm">{t.icon}</span>
              <span className="font-headline font-bold text-sm">{t.label}</span>
            </button>
          ))}
        </nav>

        {/* ── SOURCE: OURS ── */}
        {source === 'ours' && (<>
          {/* Banker */}
          <div className="glass-panel rounded-3xl p-6 flex flex-col items-center relative overflow-hidden group">
            <div className="absolute inset-0 bg-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="flex justify-between w-full mb-4">
              <span className="font-label text-xs uppercase tracking-widest text-on-surface-variant">Top Banker Insight</span>
              <span className={`font-label text-[10px] font-bold uppercase ${e.confidence_tier === 'platinum' ? 'text-primary' : e.confidence_tier === 'gold' ? 'text-secondary' : 'text-tertiary'}`}>{e.confidence_tier}</span>
            </div>
            <div className="font-headline text-7xl font-black text-secondary text-glow-secondary">{e.banker.probability}%</div>
            <div className="font-body font-extrabold text-lg mt-2 uppercase tracking-tighter">{e.banker.prediction}</div>
            <div className="w-full h-1.5 bg-surface-container-highest mt-6 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-secondary-dim to-secondary shadow-[0_0_10px_#2ff801]" style={{ width: `${e.banker.probability}%` }} />
            </div>
          </div>

          {/* Estimated Score (stitch2 exact) */}
          <div className="glass-panel rounded-3xl p-6 glow-border-primary bg-primary/5">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-headline text-xs font-bold text-primary uppercase tracking-[0.2em] mb-2">Estimated Score</h4>
                <div className="flex items-baseline gap-4">
                  <span className="font-headline text-6xl font-black text-primary text-glow-primary tracking-tighter">{e.estimated_score.home}:{e.estimated_score.away}</span>
                  <div className="flex flex-col">
                    <span className="font-label text-[11px] text-primary uppercase font-bold">Most Likely</span>
                    <span className="font-label text-[10px] text-on-surface-variant">Confidence: {e.estimated_score.probability.toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* HT/FT (stitch2 exact) */}
          <div className="glass-panel rounded-3xl p-6 glow-border-secondary bg-secondary/5">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-headline text-xs font-bold text-secondary uppercase tracking-[0.2em]">HT / FT Outcome</h4>
              <span className="font-label text-[10px] text-secondary/60 font-bold uppercase tracking-widest">High Probability</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <div className="font-headline text-4xl font-bold text-secondary text-glow-secondary mt-1">{e.ht_ft.label}</div>
              </div>
              <div className="text-right">
                <div className="font-headline text-2xl font-black text-secondary">{e.ht_ft.probability}%</div>
                <span className="font-label text-[10px] text-on-surface-variant">Predictability</span>
              </div>
            </div>
            <div className="w-full h-1 bg-surface-container-highest rounded-full overflow-hidden mt-3">
              <div className="h-full bg-secondary shadow-[0_0_10px_#2ff801]" style={{ width: `${e.ht_ft.probability}%` }} />
            </div>
          </div>

          {/* Probability Matrices + Cards/Corners grid (stitch2 exact) */}
          {(tab === 'fulltime' || tab === 'halftime') && (
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 glass-panel rounded-3xl p-6 space-y-5">
                <h3 className="font-headline text-xs font-bold text-primary tracking-widest uppercase">Probability Matrices</h3>
                <div className="space-y-4">
                  {(tab === 'fulltime' ? [
                    { l: 'Over 0.5 Goals', v: p.total_goals.over_0_5.probability },
                    { l: 'Over 1.5 Goals', v: p.total_goals.over_1_5.probability },
                    { l: 'Over 2.5 Goals', v: p.total_goals.over_2_5.probability },
                    { l: 'Under 2.5 Goals', v: p.total_goals.under_2_5.probability },
                    { l: 'Over 3.5 Goals', v: p.total_goals.over_3_5.probability },
                    { l: 'BTTS Yes', v: p.both_teams_score.probability },
                  ] : [
                    { l: 'IY Over 0.5', v: p.first_half_goals.over_0_5.probability },
                    { l: 'IY Over 1.5', v: p.first_half_goals.over_1_5.probability },
                    { l: 'IY Home Score', v: p.first_half_goals.home_team_score.probability },
                    { l: 'IY Away Score', v: p.first_half_goals.away_team_score.probability },
                    { l: 'IY BTTS', v: p.first_half_goals.both_teams_score.probability },
                  ]).map(i => (
                    <div key={i.l} className="flex flex-col gap-2">
                      <div className="flex justify-between items-end">
                        <span className="font-body text-sm font-medium text-on-surface">{i.l}</span>
                        <span className={`font-headline font-bold ${valColor(i.v)}`}>{i.v.toFixed(0)}%</span>
                      </div>
                      <ProbBar value={i.v} color={barColor(i.v)} />
                    </div>
                  ))}
                </div>
              </div>
              {/* Cards mini card (stitch2 exact) */}
              <div className="glass-panel rounded-3xl p-5 flex flex-col justify-between aspect-square">
                <div className="flex flex-col gap-1">
                  <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>style</span>
                  <span className="font-label text-[10px] text-on-surface-variant uppercase font-bold">Cards</span>
                </div>
                <div>
                  <div className="font-headline text-3xl font-bold text-secondary">{cards.probabilities.over_3_5}%</div>
                  <p className="font-body text-[10px] leading-tight text-on-surface-variant">Over 3.5 Total</p>
                </div>
              </div>
              {/* Corners mini card (stitch2 exact) */}
              <div className="glass-panel rounded-3xl p-5 flex flex-col justify-between aspect-square">
                <div className="flex flex-col gap-1">
                  <span className="material-symbols-outlined text-primary">sports_soccer</span>
                  <span className="font-label text-[10px] text-on-surface-variant uppercase font-bold">Corners</span>
                </div>
                <div>
                  <div className="font-headline text-3xl font-bold text-secondary">{corners.probabilities.over_8_5}%</div>
                  <p className="font-body text-[10px] leading-tight text-on-surface-variant">Over 8.5 Total</p>
                </div>
              </div>
            </div>
          )}

          {/* Cards detail tab */}
          {tab === 'cards' && (
            <div className="glass-panel rounded-3xl p-6 space-y-4">
              <h3 className="font-headline text-xs font-bold text-primary tracking-widest uppercase">Cards & Corners Detail</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-surface-container-low text-center">
                  <p className="font-label text-[9px] text-outline">Ev Kart</p>
                  <p className="font-headline text-xl font-bold text-primary">{cards.home_yellow.toFixed(1)}</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-container-low text-center">
                  <p className="font-label text-[9px] text-outline">Toplam</p>
                  <p className="font-headline text-2xl font-black text-secondary text-glow-secondary">{cards.total_cards_expected.toFixed(1)}</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-container-low text-center">
                  <p className="font-label text-[9px] text-outline">Dep Kart</p>
                  <p className="font-headline text-xl font-bold text-primary">{cards.away_yellow.toFixed(1)}</p>
                </div>
              </div>
              {[
                { l: 'Over 3.5 Cards', v: cards.probabilities.over_3_5 },
                { l: 'Over 4.5 Cards', v: cards.probabilities.over_4_5 },
                { l: 'Over 5.5 Cards', v: cards.probabilities.over_5_5 },
              ].map(i => (
                <div key={i.l} className="flex flex-col gap-2">
                  <div className="flex justify-between items-end">
                    <span className="font-body text-sm text-on-surface">{i.l}</span>
                    <span className={`font-headline font-bold ${valColor(i.v)}`}>{i.v}%</span>
                  </div>
                  <ProbBar value={i.v} color={barColor(i.v)} />
                </div>
              ))}

              <h3 className="font-headline text-xs font-bold text-secondary tracking-widest uppercase pt-4">Corners</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-surface-container-low text-center">
                  <p className="font-label text-[9px] text-outline">Ev</p>
                  <p className="font-headline text-xl font-bold text-secondary">{corners.home_corners_expected.toFixed(1)}</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-container-low text-center">
                  <p className="font-label text-[9px] text-outline">Toplam</p>
                  <p className="font-headline text-2xl font-black text-secondary text-glow-secondary">{corners.total_corners_expected.toFixed(1)}</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-container-low text-center">
                  <p className="font-label text-[9px] text-outline">Dep</p>
                  <p className="font-headline text-xl font-bold text-secondary">{corners.away_corners_expected.toFixed(1)}</p>
                </div>
              </div>
              {[
                { l: 'Over 8.5 Corners', v: corners.probabilities.over_8_5 },
                { l: 'Over 9.5 Corners', v: corners.probabilities.over_9_5 },
                { l: 'Over 10.5 Corners', v: corners.probabilities.over_10_5 },
              ].map(i => (
                <div key={i.l} className="flex flex-col gap-2">
                  <div className="flex justify-between items-end">
                    <span className="font-body text-sm text-on-surface">{i.l}</span>
                    <span className={`font-headline font-bold ${valColor(i.v)}`}>{i.v}%</span>
                  </div>
                  <ProbBar value={i.v} color={barColor(i.v)} />
                </div>
              ))}
            </div>
          )}
        </>)}

        {/* ── SOURCE: API FOOTBALL ── */}
        {source === 'api' && (<>
          {api ? (
            <div className="space-y-4">
              {/* API Prediction Winner */}
              {apiP?.winner && (
                <div className="glass-panel rounded-3xl p-6 glow-border-primary">
                  <h4 className="font-headline text-xs font-bold text-primary uppercase tracking-[0.2em] mb-3">API Football Prediction</h4>
                  <div className="font-headline text-3xl font-black text-primary text-glow-primary">{apiP.winner.name || 'Draw'}</div>
                  <p className="font-label text-[10px] text-on-surface-variant mt-1">{apiP.winner.comment}</p>
                </div>
              )}
              {/* API Win/Draw Percentages */}
              {apiP?.percent && (
                <div className="glass-panel rounded-3xl p-6">
                  <h4 className="font-headline text-xs font-bold text-primary uppercase tracking-[0.2em] mb-4">Win Probability</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-4 rounded-xl bg-surface-container-low text-center">
                      <p className="font-label text-[10px] text-outline">Home</p>
                      <p className="font-headline text-2xl font-black text-secondary">{apiP.percent.home}</p>
                    </div>
                    <div className="p-4 rounded-xl bg-surface-container-low text-center">
                      <p className="font-label text-[10px] text-outline">Draw</p>
                      <p className="font-headline text-2xl font-black text-on-surface">{apiP.percent.draw}</p>
                    </div>
                    <div className="p-4 rounded-xl bg-surface-container-low text-center">
                      <p className="font-label text-[10px] text-outline">Away</p>
                      <p className="font-headline text-2xl font-black text-primary">{apiP.percent.away}</p>
                    </div>
                  </div>
                </div>
              )}
              {/* API Goals / Advice */}
              {apiP?.goals && (
                <div className="glass-panel rounded-3xl p-6 glow-border-secondary bg-secondary/5">
                  <h4 className="font-headline text-xs font-bold text-secondary uppercase tracking-[0.2em] mb-2">Predicted Score</h4>
                  <div className="font-headline text-5xl font-black text-secondary text-glow-secondary tracking-tighter">
                    {apiP.goals.home ?? '?'} : {apiP.goals.away ?? '?'}
                  </div>
                  {apiP.advice && <p className="font-body text-sm text-on-surface-variant mt-3">{apiP.advice}</p>}
                </div>
              )}
              {/* API Team Comparison */}
              {api?.comparison && (
                <div className="glass-panel rounded-3xl p-6 space-y-4">
                  <h4 className="font-headline text-xs font-bold text-primary uppercase tracking-[0.2em]">Team Comparison</h4>
                  {Object.entries(api.comparison as Record<string, { home: string; away: string }>).map(([key, val]) => (
                    <div key={key}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-secondary font-headline font-bold">{val.home}</span>
                        <span className="text-on-surface-variant font-label capitalize">{key.replace(/_/g, ' ')}</span>
                        <span className="text-primary font-headline font-bold">{val.away}</span>
                      </div>
                      <div className="flex h-1.5 rounded-full overflow-hidden bg-surface-container-highest">
                        <div className="bg-secondary rounded-l-full" style={{ width: val.home }} />
                        <div className="bg-primary rounded-r-full" style={{ width: val.away }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* API H2H */}
              {apiH2H && apiH2H.length > 0 && (
                <div className="glass-panel rounded-3xl p-6">
                  <h4 className="font-headline text-xs font-bold text-tertiary uppercase tracking-[0.2em] mb-4">Head to Head (Son {Math.min(5, apiH2H.length)})</h4>
                  <div className="space-y-2">
                    {apiH2H.slice(0, 5).map((h: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-surface-container-low">
                        <span className="font-headline font-bold text-on-surface w-24 truncate">{h.teams?.home?.name}</span>
                        <span className="font-headline text-lg font-black text-primary">{h.goals?.home} - {h.goals?.away}</span>
                        <span className="font-headline font-bold text-on-surface w-24 truncate text-right">{h.teams?.away?.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="glass-panel rounded-3xl p-8 text-center">
              <span className="material-symbols-outlined text-outline text-4xl mb-3">cloud_off</span>
              <p className="font-body text-sm text-on-surface-variant">API Football tahmin verisi bu maç için mevcut değil.</p>
            </div>
          )}
        </>)}
      </main>

      {/* ═══ DESKTOP LAYOUT (stitch3) ═══ */}
      <div className="hidden lg:flex h-screen pt-20">
        {/* Sidebar (stitch3 exact) */}
        <aside className="fixed left-0 top-0 h-full flex flex-col py-8 pt-28 bg-slate-950/80 backdrop-blur-2xl shadow-2xl w-64 font-body font-medium z-40">
          <nav className="flex-1 space-y-1 px-4">
            {[
              { icon: 'grid_view', label: 'Dashboard', href: '/' },
              { icon: 'sports_soccer', label: 'Live Matches', active: true, href: '/' },
              { icon: 'receipt_long', label: 'My Bets', href: '#' },
              { icon: 'leaderboard', label: 'Analytics', href: '#' },
              { icon: 'settings', label: 'Settings', href: '#' },
            ].map(item => (
              <a key={item.label} href={item.href} className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ${item.active ? 'text-green-400 bg-green-400/10 border-r-4 border-green-400 rounded-l-xl' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800/50'}`}>
                <span className="material-symbols-outlined">{item.icon}</span>
                <span className="text-sm">{item.label}</span>
              </a>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="ml-64 flex-1 overflow-y-auto p-8">
          {/* Hero (stitch3 exact) */}
          <section className="mb-8 relative rounded-3xl overflow-hidden glass-panel p-10 border border-outline-variant/10">
            <div className="relative z-10 flex items-center justify-between gap-12">
              <div className="flex-1 flex items-center justify-end gap-6">
                <div className="text-right">
                  <h2 className="font-headline text-3xl font-bold">{match.home_team.name}</h2>
                  <p className="text-on-surface-variant font-label text-sm">Home Team</p>
                  <div className="flex gap-1 justify-end mt-2">{form.home.last_5.split('').map((r, i) => <FormDot key={i} r={r} />)}</div>
                </div>
                <div className="h-20 w-20 flex items-center justify-center bg-white/5 rounded-2xl backdrop-blur-md p-3">
                  <img src={match.home_team.logo} alt="" className="w-full h-full object-contain" />
                </div>
              </div>
              <div className="flex flex-col items-center">
                <div className="bg-error/20 text-error px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.2em] mb-4 animate-pulse">{match.status.short === 'NS' ? 'Live Soon' : match.status.long}</div>
                <div className="font-headline text-5xl font-extrabold tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-white/40">VS</div>
                <div className="mt-4 text-xs font-label text-outline uppercase tracking-widest">{match.league.name} • {match.league.round}</div>
              </div>
              <div className="flex-1 flex items-center justify-start gap-6">
                <div className="h-20 w-20 flex items-center justify-center bg-white/5 rounded-2xl backdrop-blur-md p-3">
                  <img src={match.away_team.logo} alt="" className="w-full h-full object-contain" />
                </div>
                <div>
                  <h2 className="font-headline text-3xl font-bold">{match.away_team.name}</h2>
                  <p className="text-on-surface-variant font-label text-sm">Away Team</p>
                  <div className="flex gap-1 mt-2">{form.away.last_5.split('').map((r, i) => <FormDot key={i} r={r} />)}</div>
                </div>
              </div>
            </div>
          </section>

          {/* Source Toggle */}
          <div className="flex rounded-2xl bg-surface-container-high p-1 gap-1 mb-6 max-w-md">
            <button onClick={() => setSource('ours')} className={`flex-1 py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-wider transition-all ${source === 'ours' ? 'bg-secondary/15 text-secondary' : 'text-outline'}`}>
              <span className="material-symbols-outlined text-xs mr-1 align-middle">psychology</span> Algoritmamız
            </button>
            <button onClick={() => setSource('api')} className={`flex-1 py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-wider transition-all ${source === 'api' ? 'bg-primary/15 text-primary' : 'text-outline'}`}>
              <span className="material-symbols-outlined text-xs mr-1 align-middle">api</span> API Football
            </button>
          </div>

          {source === 'ours' ? (
            <div className="grid grid-cols-12 gap-6">
              {/* Banker (stitch3 exact) */}
              <div className="col-span-4 flex flex-col">
                <div className="glass-panel p-8 rounded-3xl border border-secondary/20 h-full flex flex-col justify-between relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-secondary/10 blur-[60px] rounded-full" />
                  <div className="flex items-center gap-2 mb-6">
                    <span className="material-symbols-outlined text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                    <span className="text-xs font-label font-bold text-secondary uppercase tracking-widest">Top Banker Insight</span>
                  </div>
                  <h3 className="font-headline text-5xl font-bold text-secondary">{e.banker.probability}%</h3>
                  <p className="text-on-surface text-xl font-body mt-2">{e.banker.prediction}</p>
                  <div className="mt-8">
                    <div className="flex justify-between text-xs font-label text-outline mb-2">
                      <span>Probability Confidence</span>
                      <span>{e.confidence_tier}</span>
                    </div>
                    <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
                      <div className="h-full bg-secondary shadow-[0_0_12px_rgba(47,248,1,0.5)]" style={{ width: `${e.banker.probability}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Score + HT/FT (stitch3 exact) */}
              <div className="col-span-8 grid grid-cols-2 gap-6">
                <div className="glass-panel p-8 rounded-3xl border border-outline-variant/10 flex flex-col justify-between group hover:bg-surface-variant/50 transition-colors">
                  <div>
                    <p className="text-xs font-label text-outline uppercase tracking-widest mb-2">Estimated Score</p>
                    <h4 className="font-headline text-6xl font-bold text-primary group-hover:scale-105 transition-transform duration-500">{e.estimated_score.home}:{e.estimated_score.away}</h4>
                  </div>
                  <div className="mt-auto">
                    <div className="flex items-center gap-2 mb-1"><div className="h-1.5 w-1.5 rounded-full bg-primary" /><p className="text-sm font-body">Most Likely Outcome</p></div>
                    <p className="text-2xl font-headline font-bold">{e.estimated_score.probability.toFixed(0)}% <span className="text-xs text-outline font-normal">Confidence</span></p>
                  </div>
                </div>
                <div className="glass-panel p-8 rounded-3xl border border-outline-variant/10 flex flex-col justify-between group hover:bg-surface-variant/50 transition-colors">
                  <div>
                    <p className="text-xs font-label text-outline uppercase tracking-widest mb-2">HT / FT Outcome</p>
                    <h4 className="font-headline text-6xl font-bold text-on-surface group-hover:scale-105 transition-transform duration-500">{e.ht_ft.label}</h4>
                  </div>
                  <div className="mt-auto">
                    <div className="flex items-center gap-2 mb-1"><div className="h-1.5 w-1.5 rounded-full bg-secondary" /><p className="text-sm font-body">High Probability</p></div>
                    <p className="text-2xl font-headline font-bold">{e.ht_ft.probability}% <span className="text-xs text-outline font-normal">Predictability</span></p>
                  </div>
                </div>
              </div>

              {/* Probability Matrix (stitch3 exact) */}
              <div className="col-span-12 glass-panel p-8 rounded-3xl border border-outline-variant/10">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="font-headline text-xl font-bold">Probability Matrices</h3>
                  <div className="flex gap-4">
                    <button onClick={() => setTab('fulltime')} className={`text-xs font-label px-4 py-2 rounded-lg ${tab === 'fulltime' ? 'text-primary bg-primary/10' : 'text-outline hover:text-on-surface'}`}>Full Time</button>
                    <button onClick={() => setTab('halftime')} className={`text-xs font-label px-4 py-2 rounded-lg ${tab === 'halftime' ? 'text-primary bg-primary/10' : 'text-outline hover:text-on-surface'}`}>First Half</button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-8">
                  {/* Goal targets */}
                  <div className="space-y-6">
                    <p className="text-xs font-label text-outline uppercase tracking-widest">Goal Targets</p>
                    <div className="space-y-4">
                      {(tab === 'fulltime' ? [
                        { l: 'Over 0.5 Goals', v: p.total_goals.over_0_5.probability },
                        { l: 'Over 1.5 Goals', v: p.total_goals.over_1_5.probability },
                        { l: 'Under 2.5 Goals', v: p.total_goals.under_2_5.probability },
                        { l: 'Over 2.5 Goals', v: p.total_goals.over_2_5.probability },
                        { l: 'BTTS', v: p.both_teams_score.probability },
                      ] : [
                        { l: 'IY Over 0.5', v: p.first_half_goals.over_0_5.probability },
                        { l: 'IY Over 1.5', v: p.first_half_goals.over_1_5.probability },
                        { l: 'IY BTTS', v: p.first_half_goals.both_teams_score.probability },
                      ]).map(i => (
                        <div key={i.l} className="flex items-center justify-between p-4 rounded-2xl bg-surface-container-low border border-outline-variant/5">
                          <span className="font-headline font-medium">{i.l}</span>
                          <span className={`font-headline font-bold ${valColor(i.v)}`}>{i.v.toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Cards & Corners (stitch3 Dynamic Factors) */}
                  <div className="space-y-6">
                    <p className="text-xs font-label text-outline uppercase tracking-widest">Dynamic Factors</p>
                    <div className="p-6 rounded-2xl bg-surface-container-high relative overflow-hidden">
                      <div className="absolute inset-y-0 left-0 w-1 bg-primary" />
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <p className="text-xs font-label text-outline mb-1">Cards Prediction</p>
                          <p className="font-headline text-xl font-bold">Over 3.5 Cards</p>
                        </div>
                        <div className="bg-primary/20 p-2 rounded-lg">
                          <span className="material-symbols-outlined text-primary text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>style</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex-1 h-1 bg-surface-container rounded-full overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${cards.probabilities.over_3_5}%` }} />
                        </div>
                        <span className="text-sm font-headline font-bold">{cards.probabilities.over_3_5}%</span>
                      </div>
                    </div>
                    <div className="p-6 rounded-2xl bg-surface-container-high relative overflow-hidden">
                      <div className="absolute inset-y-0 left-0 w-1 bg-secondary" />
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <p className="text-xs font-label text-outline mb-1">Corners Prediction</p>
                          <p className="font-headline text-xl font-bold">Over 8.5 Corners</p>
                        </div>
                        <div className="bg-secondary/20 p-2 rounded-lg">
                          <span className="material-symbols-outlined text-secondary text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>change_history</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex-1 h-1 bg-surface-container rounded-full overflow-hidden">
                          <div className="h-full bg-secondary" style={{ width: `${corners.probabilities.over_8_5}%` }} />
                        </div>
                        <span className="text-sm font-headline font-bold">{corners.probabilities.over_8_5}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Historical Bias (stitch3 exact) */}
                  <div className="space-y-6">
                    <p className="text-xs font-label text-outline uppercase tracking-widest">Historical Bias</p>
                    <div className="glass-panel rounded-2xl p-6 border border-outline-variant/10 h-[280px] flex flex-col justify-between">
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-outline">H2H Domination</span>
                          <span className="text-on-surface">{form.h2h.total > 0 ? `${Math.round((form.h2h.home_wins / form.h2h.total) * 100)}% (${match.home_team.name})` : 'N/A'}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-outline">Recent Form (5)</span>
                          <div className="flex gap-1">{form.home.last_5.split('').map((r, i) => <FormDot key={i} r={r} />)}</div>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-outline">1X2</span>
                          <span className="text-on-surface font-headline font-bold">{p.match_result.home_win.probability.toFixed(0)}% / {p.match_result.draw.probability.toFixed(0)}% / {p.match_result.away_win.probability.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="mt-auto pt-6 border-t border-outline-variant/10">
                        <p className="text-[10px] text-outline italic leading-relaxed">Analiz: {data.metadata.engines_used.join(' + ')} motorları kullanıldı. Güven: {e.confidence}%</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Desktop API Football View */
            api ? (
              <div className="grid grid-cols-12 gap-6">
                {apiP?.winner && (
                  <div className="col-span-4 glass-panel p-8 rounded-3xl border border-primary/20">
                    <h4 className="font-headline text-xs font-bold text-primary uppercase tracking-widest mb-4">API Prediction</h4>
                    <h3 className="font-headline text-4xl font-bold text-primary">{apiP.winner.name || 'Draw'}</h3>
                    <p className="text-on-surface-variant text-sm mt-2">{apiP.winner.comment}</p>
                    {apiP.advice && <p className="mt-4 p-3 rounded-xl bg-primary/5 text-sm font-body text-primary">{apiP.advice}</p>}
                  </div>
                )}
                {apiP?.percent && (
                  <div className="col-span-4 glass-panel p-8 rounded-3xl border border-outline-variant/10">
                    <h4 className="font-headline text-xs font-bold text-outline uppercase tracking-widest mb-4">Win Probability</h4>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center"><p className="text-xs text-outline">Home</p><p className="font-headline text-3xl font-bold text-secondary">{apiP.percent.home}</p></div>
                      <div className="text-center"><p className="text-xs text-outline">Draw</p><p className="font-headline text-3xl font-bold">{apiP.percent.draw}</p></div>
                      <div className="text-center"><p className="text-xs text-outline">Away</p><p className="font-headline text-3xl font-bold text-primary">{apiP.percent.away}</p></div>
                    </div>
                  </div>
                )}
                {apiP?.goals && (
                  <div className="col-span-4 glass-panel p-8 rounded-3xl border border-secondary/20">
                    <h4 className="font-headline text-xs font-bold text-secondary uppercase tracking-widest mb-4">Predicted Score</h4>
                    <h3 className="font-headline text-5xl font-bold text-secondary text-glow-secondary">{apiP.goals.home ?? '?'} : {apiP.goals.away ?? '?'}</h3>
                  </div>
                )}
                {api?.comparison && (
                  <div className="col-span-12 glass-panel p-8 rounded-3xl border border-outline-variant/10">
                    <h4 className="font-headline text-xs font-bold text-outline uppercase tracking-widest mb-6">Team Comparison</h4>
                    <div className="grid grid-cols-2 gap-x-12 gap-y-4">
                      {Object.entries(api.comparison as Record<string, { home: string; away: string }>).map(([key, val]) => (
                        <div key={key}>
                          <div className="flex justify-between text-xs mb-1.5">
                            <span className="text-secondary font-headline font-bold">{val.home}</span>
                            <span className="text-on-surface-variant font-label capitalize">{key.replace(/_/g, ' ')}</span>
                            <span className="text-primary font-headline font-bold">{val.away}</span>
                          </div>
                          <div className="flex h-2 rounded-full overflow-hidden bg-surface-container-highest">
                            <div className="bg-secondary rounded-l-full transition-all" style={{ width: val.home }} />
                            <div className="bg-primary rounded-r-full transition-all" style={{ width: val.away }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="glass-panel rounded-3xl p-12 text-center">
                <span className="material-symbols-outlined text-outline text-5xl mb-4">cloud_off</span>
                <p className="font-headline text-lg text-on-surface-variant">API Football tahmin verisi mevcut değil</p>
              </div>
            )
          )}

          <div className="h-24" />
        </main>
      </div>

      {/* Mobile Bottom Nav (stitch2 exact) */}
      <nav className="lg:hidden fixed bottom-0 w-full z-50 bg-[#090e1c]/80 backdrop-blur-2xl rounded-t-3xl border-t border-white/5 flex justify-around items-center pt-3 pb-8 px-4 shadow-[0_-10px_40px_rgba(0,244,254,0.06)]">
        <a href="/" className="flex flex-col items-center justify-center bg-primary/10 text-primary rounded-xl px-4 py-1">
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>home</span>
          <span className="font-label text-[10px] font-medium tracking-tight">Home</span>
        </a>
        <a href="/" className="flex flex-col items-center justify-center text-slate-500 hover:text-primary transition-all">
          <span className="material-symbols-outlined">table_chart</span>
          <span className="font-label text-[10px] font-medium tracking-tight">Live</span>
        </a>
        <div className="flex flex-col items-center justify-center text-slate-500">
          <span className="material-symbols-outlined">grade</span>
          <span className="font-label text-[10px] font-medium tracking-tight">Favorites</span>
        </div>
        <div className="flex flex-col items-center justify-center text-slate-500">
          <span className="material-symbols-outlined">person</span>
          <span className="font-label text-[10px] font-medium tracking-tight">Account</span>
        </div>
      </nav>

      {/* Background blurs */}
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-500/10 blur-[120px] rounded-full pointer-events-none -z-10" />
      <div className="fixed top-[-10%] left-[-10%] w-[30%] h-[30%] bg-green-500/5 blur-[120px] rounded-full pointer-events-none -z-10" />

      {/* Velocity Glass CSS */}
      <style jsx global>{`
        .mesh-gradient { position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;background:radial-gradient(at 0% 0%,#0d1323 0%,transparent 50%),radial-gradient(at 100% 0%,#1a1033 0%,transparent 50%),radial-gradient(at 50% 50%,#090e1c 0%,transparent 100%),radial-gradient(at 80% 90%,#00f4fe22 0%,transparent 40%),radial-gradient(at 20% 80%,#7000ff11 0%,transparent 40%) }
        .glass-panel { background:rgba(30,37,59,0.4);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(161,250,255,0.05) }
        .text-glow-primary { text-shadow:0 0 15px rgba(161,250,255,0.6) }
        .text-glow-secondary { text-shadow:0 0 15px rgba(47,248,1,0.6) }
        .prob-bar { height:4px;border-radius:2px;background:rgba(255,255,255,0.1) }
        .glow-border-primary { box-shadow:0 0 20px rgba(161,250,255,0.15);border:1px solid rgba(161,250,255,0.3) }
        .glow-border-secondary { box-shadow:0 0 20px rgba(47,248,1,0.15);border:1px solid rgba(47,248,1,0.3) }
        .no-scrollbar::-webkit-scrollbar { display:none }
        .no-scrollbar { -ms-overflow-style:none;scrollbar-width:none }
      `}</style>
    </div>
  );
}
