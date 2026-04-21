
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { PredictionCard } from './prediction-card';
import { AdvancedPredictionCard } from './advanced-prediction-card';
import { ApiPredictionsCard } from './api-predictions-card';
import { MatchCard } from './match-card';
import { MatchPrediction } from '@/lib/prediction-engine';
import { AdvancedMatchPrediction } from '@/lib/advanced-prediction-engine';
import { Fixture } from '@/lib/api-football';
import type { EnhancedPredictionResult } from '@/lib/enhanced-prediction-engine';
import { TrendingUp, Loader2 } from 'lucide-react';

interface PredictionModalProps {
  match: Fixture;
  children?: React.ReactNode;
}

/* ── Velocity Glass mini components for modal ── */
function VGBar({ value, color = 'green' }: { value: number; color?: string }) {
  const cls = color === 'green' ? 'bg-[#2ff801] shadow-[0_0_8px_#2ff801]' :
              color === 'cyan' ? 'bg-[#a1faff] shadow-[0_0_8px_rgba(161,250,255,0.5)]' :
              color === 'red' ? 'bg-[#ff716c]' : 'bg-[#ac89ff]';
  return (
    <div className="h-1 w-full bg-[#1e253b] rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

function VGColor(v: number) {
  if (v >= 70) return 'text-[#2ff801]';
  if (v >= 50) return 'text-[#a1faff]';
  if (v >= 35) return 'text-[#ac89ff]';
  return 'text-[#ff716c]';
}

function VGBarColor(v: number) {
  if (v >= 70) return 'green';
  if (v >= 50) return 'cyan';
  if (v >= 35) return 'purple';
  return 'red';
}

function FormDots({ form }: { form: string }) {
  return (
    <div className="flex gap-1">
      {form.split('').map((r, i) => (
        <span key={i} className={`w-2 h-2 rounded-full ${r === 'W' ? 'bg-[#2ff801]' : r === 'L' ? 'bg-[#ff716c]' : 'bg-[#707588]'}`} />
      ))}
    </div>
  );
}

/* ── Ultra Analysis Tab Content ── */
function UltraAnalysisTab({ data }: { data: EnhancedPredictionResult }) {
  const { match: m, prediction: p, cards, corners, odds, ensemble: e, form } = data;
  const [subTab, setSubTab] = useState<'goals' | 'cards' | 'corners' | 'htft' | 'score' | 'odds'>('goals');

  return (
    <div className="bg-[#090e1c] text-[#e1e4fa] rounded-2xl p-5 space-y-4 font-body" style={{ fontFamily: "'Manrope', sans-serif" }}>
      {/* Match header mini */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={m.home_team.logo} className="w-8 h-8" alt="" />
          <div>
            <p className="font-headline text-sm font-bold">{m.home_team.name}</p>
            <div className="flex items-center gap-2">
              <FormDots form={form.home.last_5} />
              <span className="text-[10px] text-[#707588]">{form.home.position > 0 ? `${form.home.position}.` : ''}</span>
            </div>
          </div>
        </div>
        <div className="text-center">
          <p className="font-headline text-lg font-bold text-[#a1faff]">VS</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="font-headline text-sm font-bold">{m.away_team.name}</p>
            <div className="flex items-center gap-2 justify-end">
              <span className="text-[10px] text-[#707588]">{form.away.position > 0 ? `${form.away.position}.` : ''}</span>
              <FormDots form={form.away.last_5} />
            </div>
          </div>
          <img src={m.away_team.logo} className="w-8 h-8" alt="" />
        </div>
      </div>

      {/* Banker + Score + HT/FT row — uses allMarkets (Deep Integration) when available */}
      {(() => {
        const am = data.allMarkets;
        // Best exact score from allMarkets
        const bestScore = am?.exactScores?.[0];
        // Best HT/FT from allMarkets
        const bestHTFT = am?.htft ? Object.entries(am.htft).sort((a, b) => (b[1] as number) - (a[1] as number))[0] : null;

        return (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#13192b] rounded-xl p-3 border border-[#2ff801]/20">
              <p className="text-[9px] text-[#707588] uppercase tracking-wider font-label">Banker</p>
              <p className="font-headline text-2xl font-black text-[#2ff801]" style={{ textShadow: '0 0 10px rgba(47,248,1,0.4)' }}>{e.banker.probability}%</p>
              <p className="text-[10px] text-[#e1e4fa] font-bold mt-0.5">{e.banker.prediction}</p>
              <div className="mt-2"><VGBar value={e.banker.probability} color="green" /></div>
            </div>
            <div className="bg-[#13192b] rounded-xl p-3 border border-[#a1faff]/10">
              <p className="text-[9px] text-[#707588] uppercase tracking-wider font-label">Skor</p>
              <p className="font-headline text-2xl font-black text-[#a1faff]" style={{ textShadow: '0 0 10px rgba(161,250,255,0.4)' }}>
                {bestScore ? bestScore.score : `${e.estimated_score.home}:${e.estimated_score.away}`}
              </p>
              <p className="text-[10px] text-[#707588]">%{bestScore ? bestScore.probability.toFixed(0) : e.estimated_score.probability.toFixed(0)} güven</p>
            </div>
            <div className="bg-[#13192b] rounded-xl p-3 border border-[#a1faff]/10">
              <p className="text-[9px] text-[#707588] uppercase tracking-wider font-label">HT/FT</p>
              <p className="font-headline text-2xl font-black text-[#e1e4fa]">
                {bestHTFT ? bestHTFT[0] : e.ht_ft.label}
              </p>
              <p className="text-[10px] text-[#707588]">%{bestHTFT ? (bestHTFT[1] as number).toFixed(1) : e.ht_ft.probability} olasılık</p>
            </div>
          </div>
        );
      })()}

      {/* 1X2 bar */}
      <div className="bg-[#13192b] rounded-xl p-3">
        <div className="flex justify-between text-[10px] text-[#707588] mb-1.5">
          <span>Ev %{p.match_result.home_win.probability.toFixed(0)}</span>
          <span>X %{p.match_result.draw.probability.toFixed(0)}</span>
          <span>Dep %{p.match_result.away_win.probability.toFixed(0)}</span>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden bg-[#1e253b]">
          <div className="bg-[#2ff801] rounded-l-full" style={{ width: `${p.match_result.home_win.probability}%` }} />
          <div className="bg-[#707588]" style={{ width: `${p.match_result.draw.probability}%` }} />
          <div className="bg-[#a1faff] rounded-r-full" style={{ width: `${p.match_result.away_win.probability}%` }} />
        </div>
      </div>

      {/* Sub tabs */}
      <div className="flex gap-1.5 bg-[#0d1323] rounded-xl p-1">
        {([
          { id: 'goals' as const, label: 'Goller', icon: 'sports_soccer' },
          { id: 'cards' as const, label: 'Kartlar', icon: 'style' },
          { id: 'corners' as const, label: 'Kornerler', icon: 'change_history' },
          { id: 'htft' as const, label: 'HT/FT', icon: 'timer' },
          { id: 'score' as const, label: 'Skor', icon: 'scoreboard' },
          { id: 'odds' as const, label: 'Oranlar', icon: 'trending_up' },
        ]).map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={`flex-1 py-2 rounded-lg text-[10px] font-label font-bold uppercase tracking-wider transition-all ${subTab === t.id ? 'bg-[#2ff801]/10 text-[#2ff801]' : 'text-[#707588] hover:text-[#a6aabf]'}`}>
            <span className="material-symbols-outlined text-xs mr-0.5 align-middle">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Goals sub-tab */}
      {subTab === 'goals' && (
        <div className="space-y-2.5">
          {[
            { l: 'Over 0.5 Gol', v: p.total_goals.over_0_5.probability },
            { l: 'Over 1.5 Gol', v: p.total_goals.over_1_5.probability },
            { l: 'Over 2.5 Gol', v: p.total_goals.over_2_5.probability },
            { l: 'Under 2.5 Gol', v: p.total_goals.under_2_5.probability },
            { l: 'Over 3.5 Gol', v: p.total_goals.over_3_5.probability },
            { l: 'Under 3.5 Gol', v: p.total_goals.under_3_5.probability },
            { l: 'KG (BTTS)', v: p.both_teams_score.probability },
          ].map(i => (
            <div key={i.l}>
              <div className="flex justify-between mb-0.5">
                <span className="text-xs text-[#a6aabf]">{i.l}</span>
                <span className={`text-xs font-headline font-bold ${VGColor(i.v)}`}>{i.v.toFixed(0)}%</span>
              </div>
              <VGBar value={i.v} color={VGBarColor(i.v)} />
            </div>
          ))}
          {/* First half */}
          <p className="text-[9px] text-[#707588] uppercase tracking-wider pt-2">İlk Yarı</p>
          {[
            { l: 'IY Over 0.5', v: p.first_half_goals.over_0_5.probability },
            { l: 'IY Over 1.5', v: p.first_half_goals.over_1_5.probability },
            { l: 'IY KG', v: p.first_half_goals.both_teams_score.probability },
          ].map(i => (
            <div key={i.l}>
              <div className="flex justify-between mb-0.5">
                <span className="text-xs text-[#a6aabf]">{i.l}</span>
                <span className={`text-xs font-headline font-bold ${VGColor(i.v)}`}>{i.v.toFixed(0)}%</span>
              </div>
              <VGBar value={i.v} color={VGBarColor(i.v)} />
            </div>
          ))}
        </div>
      )}

      {/* Cards sub-tab */}
      {subTab === 'cards' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[#0d1323] rounded-lg p-2 text-center">
              <p className="text-[9px] text-[#707588]">Ev</p>
              <p className="font-headline text-lg font-bold text-[#a1faff]">{cards.home_yellow.toFixed(1)}</p>
            </div>
            <div className="bg-[#0d1323] rounded-lg p-2 text-center">
              <p className="text-[9px] text-[#707588]">Toplam</p>
              <p className="font-headline text-xl font-black text-[#2ff801]">{cards.total_cards_expected.toFixed(1)}</p>
            </div>
            <div className="bg-[#0d1323] rounded-lg p-2 text-center">
              <p className="text-[9px] text-[#707588]">Dep</p>
              <p className="font-headline text-lg font-bold text-[#a1faff]">{cards.away_yellow.toFixed(1)}</p>
            </div>
          </div>
          {[
            { l: 'Over 2.5 Kart', v: cards.probabilities.over_2_5 },
            { l: 'Over 3.5 Kart', v: cards.probabilities.over_3_5 },
            { l: 'Over 4.5 Kart', v: cards.probabilities.over_4_5 },
            { l: 'Over 5.5 Kart', v: cards.probabilities.over_5_5 },
            { l: 'Under 3.5 Kart', v: cards.probabilities.under_3_5 },
            { l: 'Under 4.5 Kart', v: cards.probabilities.under_4_5 },
          ].map(i => (
            <div key={i.l}>
              <div className="flex justify-between mb-0.5">
                <span className="text-xs text-[#a6aabf]">{i.l}</span>
                <span className={`text-xs font-headline font-bold ${VGColor(i.v)}`}>{i.v}%</span>
              </div>
              <VGBar value={i.v} color={VGBarColor(i.v)} />
            </div>
          ))}
          <div className="flex gap-2 text-[10px] pt-1">
            <span className="text-[#707588]">Veri: <span className={cards.data_quality === 'high' ? 'text-[#2ff801]' : cards.data_quality === 'medium' ? 'text-[#a1faff]' : 'text-[#ff716c]'}>{cards.data_quality}</span></span>
            <span className="text-[#707588]">• {cards.factors.matches_analyzed} maç analiz</span>
            {cards.factors.referee_name && <span className="text-[#707588]">• Hakem: {cards.factors.referee_name}</span>}
          </div>
        </div>
      )}

      {/* Corners sub-tab */}
      {subTab === 'corners' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[#0d1323] rounded-lg p-2 text-center">
              <p className="text-[9px] text-[#707588]">Ev</p>
              <p className="font-headline text-lg font-bold text-[#2ff801]">{corners.home_corners_expected.toFixed(1)}</p>
            </div>
            <div className="bg-[#0d1323] rounded-lg p-2 text-center">
              <p className="text-[9px] text-[#707588]">Toplam</p>
              <p className="font-headline text-xl font-black text-[#2ff801]">{corners.total_corners_expected.toFixed(1)}</p>
            </div>
            <div className="bg-[#0d1323] rounded-lg p-2 text-center">
              <p className="text-[9px] text-[#707588]">Dep</p>
              <p className="font-headline text-lg font-bold text-[#2ff801]">{corners.away_corners_expected.toFixed(1)}</p>
            </div>
          </div>
          {[
            { l: 'Over 8.5 Korner', v: corners.probabilities.over_8_5 },
            { l: 'Over 9.5 Korner', v: corners.probabilities.over_9_5 },
            { l: 'Over 10.5 Korner', v: corners.probabilities.over_10_5 },
            { l: 'Under 9.5 Korner', v: corners.probabilities.under_9_5 },
            { l: 'Under 10.5 Korner', v: corners.probabilities.under_10_5 },
          ].map(i => (
            <div key={i.l}>
              <div className="flex justify-between mb-0.5">
                <span className="text-xs text-[#a6aabf]">{i.l}</span>
                <span className={`text-xs font-headline font-bold ${VGColor(i.v)}`}>{i.v}%</span>
              </div>
              <VGBar value={i.v} color={VGBarColor(i.v)} />
            </div>
          ))}
          <p className="text-[9px] text-[#707588] uppercase tracking-wider pt-1">İlk Yarı Korner</p>
          {[
            { l: 'IY Over 3.5', v: corners.first_half_corners.over_3_5 },
            { l: 'IY Over 4.5', v: corners.first_half_corners.over_4_5 },
          ].map(i => (
            <div key={i.l}>
              <div className="flex justify-between mb-0.5">
                <span className="text-xs text-[#a6aabf]">{i.l}</span>
                <span className={`text-xs font-headline font-bold ${VGColor(i.v)}`}>{i.v}%</span>
              </div>
              <VGBar value={i.v} color={VGBarColor(i.v)} />
            </div>
          ))}
          <div className="flex gap-2 text-[10px] pt-1">
            <span className="text-[#707588]">Tempo: {corners.factors.match_tempo_factor.toFixed(2)}x</span>
            <span className="text-[#707588]">• Baskı: {corners.factors.attack_pressure_index.toFixed(2)}</span>
            <span className="text-[#707588]">• Veri: <span className={corners.data_quality === 'high' ? 'text-[#2ff801]' : 'text-[#a1faff]'}>{corners.data_quality}</span></span>
          </div>
        </div>
      )}

      {/* HT/FT sub-tab */}
      {subTab === 'htft' && data?.allMarkets && (
        <div className="space-y-2.5">
          <p className="text-[9px] text-[#707588] uppercase tracking-wider">İlk Yarı Sonucu</p>
          {[
            { l: 'IY Ev Sahibi', v: data.allMarkets.htResult.home },
            { l: 'IY Beraberlik', v: data.allMarkets.htResult.draw },
            { l: 'IY Deplasman', v: data.allMarkets.htResult.away },
          ].map(i => (
            <div key={i.l}>
              <div className="flex justify-between mb-0.5">
                <span className="text-xs text-[#a6aabf]">{i.l}</span>
                <span className={`text-xs font-headline font-bold ${VGColor(i.v)}`}>{i.v.toFixed(0)}%</span>
              </div>
              <VGBar value={i.v} color={VGBarColor(i.v)} />
            </div>
          ))}
          <p className="text-[9px] text-[#707588] uppercase tracking-wider pt-2">IY/MS Kombinasyonları</p>
          <div className="grid grid-cols-3 gap-1.5">
            {Object.entries(data.allMarkets.htft).map(([key, val]) => (
              <div key={key} className={`text-center py-1.5 rounded-lg ${val > 20 ? 'bg-[#2ff801]/10 text-[#2ff801]' : val > 10 ? 'bg-[#a1faff]/10 text-[#a1faff]' : 'bg-[#1e253b] text-[#707588]'}`}>
                <div className="text-[10px] font-bold">{key}</div>
                <div className="text-xs font-headline font-bold">{val.toFixed(1)}%</div>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-[#707588] uppercase tracking-wider pt-2">İlk Yarı Golleri</p>
          {[
            { l: 'IY Over 0.5', v: data.allMarkets.firstHalfGoals.over_0_5 },
            { l: 'IY Over 1.5', v: data.allMarkets.firstHalfGoals.over_1_5 },
            { l: 'IY KG', v: data.allMarkets.firstHalfGoals.btts },
          ].map(i => (
            <div key={i.l}>
              <div className="flex justify-between mb-0.5">
                <span className="text-xs text-[#a6aabf]">{i.l}</span>
                <span className={`text-xs font-headline font-bold ${VGColor(i.v)}`}>{i.v.toFixed(0)}%</span>
              </div>
              <VGBar value={i.v} color={VGBarColor(i.v)} />
            </div>
          ))}
          <p className="text-[9px] text-[#707588] uppercase tracking-wider pt-2">2. Yarı Golleri</p>
          {[
            { l: '2Y Over 0.5', v: data.allMarkets.secondHalfGoals.over_0_5 },
            { l: '2Y Over 1.5', v: data.allMarkets.secondHalfGoals.over_1_5 },
          ].map(i => (
            <div key={i.l}>
              <div className="flex justify-between mb-0.5">
                <span className="text-xs text-[#a6aabf]">{i.l}</span>
                <span className={`text-xs font-headline font-bold ${VGColor(i.v)}`}>{i.v.toFixed(0)}%</span>
              </div>
              <VGBar value={i.v} color={VGBarColor(i.v)} />
            </div>
          ))}
          {data.context && (
            <div className="flex flex-wrap gap-1.5 text-[9px] mt-2">
              <span className="text-[#707588]">xG 1Y: {data.context.xg.firstHalf.toFixed(2)}</span>
              <span className="text-[#707588]">xG 2Y: {data.context.xg.secondHalf.toFixed(2)}</span>
              <span className="text-[#707588]">Intensity: {(data.context.intensity.score * 100).toFixed(0)}%</span>
            </div>
          )}
        </div>
      )}

      {/* Score sub-tab */}
      {subTab === 'score' && data?.allMarkets && (
        <div className="space-y-2.5">
          <p className="text-[9px] text-[#707588] uppercase tracking-wider">En Olası Skorlar</p>
          <div className="grid grid-cols-2 gap-1.5">
            {data.allMarkets.exactScores.slice(0, 12).map((s, i) => (
              <div key={s.score} className={`flex items-center justify-between py-1.5 px-2.5 rounded-lg ${i === 0 ? 'bg-[#2ff801]/10 border border-[#2ff801]/20' : 'bg-[#1e253b]'}`}>
                <span className={`text-sm font-headline font-bold ${i === 0 ? 'text-[#2ff801]' : 'text-[#a6aabf]'}`}>{s.score}</span>
                <span className={`text-xs font-bold ${i === 0 ? 'text-[#2ff801]' : 'text-[#707588]'}`}>{s.probability.toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-[#707588] uppercase tracking-wider pt-2">Tüm Gol Çizgileri</p>
          {[
            { l: 'Over 0.5', v: data.allMarkets.goals.over_0_5 },
            { l: 'Over 1.5', v: data.allMarkets.goals.over_1_5 },
            { l: 'Over 2.5', v: data.allMarkets.goals.over_2_5 },
            { l: 'Over 3.5', v: data.allMarkets.goals.over_3_5 },
            { l: 'Over 4.5', v: data.allMarkets.goals.over_4_5 },
            { l: 'Over 5.5', v: data.allMarkets.goals.over_5_5 },
          ].map(i => (
            <div key={i.l}>
              <div className="flex justify-between mb-0.5">
                <span className="text-xs text-[#a6aabf]">{i.l}</span>
                <span className={`text-xs font-headline font-bold ${VGColor(i.v)}`}>{i.v.toFixed(0)}%</span>
              </div>
              <VGBar value={i.v} color={VGBarColor(i.v)} />
            </div>
          ))}
          <p className="text-[9px] text-[#707588] uppercase tracking-wider pt-2">Takım Golleri</p>
          {[
            { l: `Ev O1.5`, v: data.allMarkets.homeGoals.over_1_5 },
            { l: `Ev O2.5`, v: data.allMarkets.homeGoals.over_2_5 },
            { l: `Dep O1.5`, v: data.allMarkets.awayGoals.over_1_5 },
            { l: `Dep O2.5`, v: data.allMarkets.awayGoals.over_2_5 },
          ].map(i => (
            <div key={i.l}>
              <div className="flex justify-between mb-0.5">
                <span className="text-xs text-[#a6aabf]">{i.l}</span>
                <span className={`text-xs font-headline font-bold ${VGColor(i.v)}`}>{i.v.toFixed(0)}%</span>
              </div>
              <VGBar value={i.v} color={VGBarColor(i.v)} />
            </div>
          ))}
        </div>
      )}

      {/* Odds sub-tab */}
      {subTab === 'odds' && (
        <div className="space-y-3">
          {odds.data_available ? (<>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-[#0d1323] rounded-lg p-2 text-center">
                <p className="text-[9px] text-[#707588]">Ev</p>
                <p className="font-headline text-lg font-bold text-[#e1e4fa]">{odds.best_odds.home.odds.toFixed(2)}</p>
                <p className="text-[9px] text-[#a1faff]">%{odds.market_consensus.fair_home.toFixed(0)}</p>
              </div>
              <div className="bg-[#0d1323] rounded-lg p-2 text-center">
                <p className="text-[9px] text-[#707588]">X</p>
                <p className="font-headline text-lg font-bold text-[#e1e4fa]">{odds.best_odds.draw.odds.toFixed(2)}</p>
                <p className="text-[9px] text-[#a1faff]">%{odds.market_consensus.fair_draw.toFixed(0)}</p>
              </div>
              <div className="bg-[#0d1323] rounded-lg p-2 text-center">
                <p className="text-[9px] text-[#707588]">Dep</p>
                <p className="font-headline text-lg font-bold text-[#e1e4fa]">{odds.best_odds.away.odds.toFixed(2)}</p>
                <p className="text-[9px] text-[#a1faff]">%{odds.market_consensus.fair_away.toFixed(0)}</p>
              </div>
            </div>
            {odds.market_signal.strength !== 'weak' && (
              <div className={`p-3 rounded-lg border-l-2 ${odds.market_signal.strength === 'strong' ? 'bg-[#2ff801]/5 border-[#2ff801]' : 'bg-[#ac89ff]/5 border-[#ac89ff]'}`}>
                <p className="text-[10px] font-label uppercase text-[#ac89ff] font-bold">{odds.market_signal.strength === 'strong' ? 'Güçlü Sinyal' : 'Orta Sinyal'}</p>
                <p className="text-xs text-[#a6aabf] mt-0.5">{odds.market_signal.description}</p>
              </div>
            )}
            {odds.value_bets.length > 0 && (<>
              <p className="text-[9px] text-[#2ff801] uppercase tracking-wider font-label font-bold">Value Bets ({odds.value_bets.length})</p>
              {odds.value_bets.slice(0, 4).map((vb, i) => (
                <div key={i} className="flex justify-between items-center bg-[#0d1323] rounded-lg p-2.5">
                  <div>
                    <p className="text-xs font-bold text-[#e1e4fa]">{vb.selection}</p>
                    <p className="text-[9px] text-[#707588]">{vb.market} • {vb.bookmaker}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-headline font-bold text-[#2ff801]">+{vb.edge.toFixed(1)}%</p>
                    <p className="text-[9px] text-[#707588]">@{vb.best_odds.toFixed(2)} K:{vb.kelly_stake.toFixed(1)}%</p>
                  </div>
                </div>
              ))}
            </>)}
            <p className="text-[9px] text-[#434759]">Overround: {odds.market_consensus.overround.toFixed(1)}% • {odds.bookmakers_count} bahisçi</p>
          </>) : (
            <div className="text-center py-6">
              <p className="text-sm text-[#707588]">Oran verisi mevcut değil</p>
            </div>
          )}
        </div>
      )}

      {/* Calibration & Top Picks */}
      {data.calibration && (
        <div className="space-y-3 pt-2 border-t border-[#1e253b]">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-[#707588] uppercase tracking-wider font-label font-bold">
              <span className="material-symbols-outlined text-[10px] mr-0.5 align-middle text-[#a1faff]">verified</span> Kalibre Edilmiş Tahminler
            </span>
            <span className="text-[9px] text-[#707588]">
              Sağlama: %{data.calibration.cross_validation_score}
            </span>
          </div>

          {data.calibration.top_picks.length > 0 && (
            <div className="space-y-1.5">
              {data.calibration.top_picks.map((tp, i) => (
                <div key={i} className={`flex items-center justify-between p-2 rounded-lg ${tp.recommendation === 'strong_bet' ? 'bg-[#2ff801]/8 border border-[#2ff801]/20' : 'bg-[#0d1323]'}`}>
                  <div className="flex items-center gap-2">
                    {tp.recommendation === 'strong_bet' && <span className="text-[#2ff801] text-[10px]">★</span>}
                    <div>
                      <p className="text-[11px] font-bold text-[#e1e4fa]">{tp.selection}</p>
                      <p className="text-[9px] text-[#707588]">{tp.market} • {tp.sources_agreeing}/{tp.total_sources} kaynak</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-[11px] font-headline font-bold ${tp.calibrated_probability > 60 ? 'text-[#2ff801]' : 'text-[#a1faff]'}`}>
                      %{tp.calibrated_probability.toFixed(0)}
                    </p>
                    {tp.is_value_bet && (
                      <p className="text-[9px] text-[#2ff801]">+{tp.edge.toFixed(1)}% edge</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confidence footer */}
      <div className="flex justify-between items-center pt-2 border-t border-[#1e253b]">
        <div className="flex gap-2">
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-label font-bold uppercase ${e.confidence_tier === 'platinum' ? 'bg-[#a1faff]/10 text-[#a1faff]' : e.confidence_tier === 'gold' ? 'bg-[#2ff801]/10 text-[#2ff801]' : 'bg-[#ac89ff]/10 text-[#ac89ff]'}`}>
            {e.confidence_tier}
          </span>
          <span className="text-[9px] text-[#434759]">{data.metadata.engines_used.length} motor • Sağlama: {data.calibration?.cross_validation_score ?? '?'}%</span>
        </div>
        <span className="text-[9px] text-[#434759]">v{data.metadata.algorithm_version}</span>
      </div>
    </div>
  );
}

/* ── Main Modal ── */
export function PredictionModal({ match, children }: PredictionModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [prediction, setPrediction] = useState<MatchPrediction | null>(null);
  const [advancedPrediction, setAdvancedPrediction] = useState<AdvancedMatchPrediction | null>(null);
  const [apiPredictions, setApiPredictions] = useState<any | null>(null);
  const [enhancedData, setEnhancedData] = useState<EnhancedPredictionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [enhancedLoading, setEnhancedLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPrediction = async () => {
    if (prediction || loading) return;

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/predictions/${match.fixture.id}`);
      const data = await response.json();

      if (data.success) {
        setPrediction(data.data.prediction);
        setAdvancedPrediction(data.data.advancedPrediction);
        setApiPredictions(data.data.apiPredictions);
      } else {
        setError(data.message || 'Failed to generate prediction');
      }
    } catch (err) {
      setError('Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  const fetchEnhanced = async () => {
    if (enhancedData || enhancedLoading) return;

    try {
      setEnhancedLoading(true);
      const response = await fetch(`/api/predictions/${match.fixture.id}/enhanced`);
      const data = await response.json();
      if (data.success) {
        setEnhancedData(data.data);
      }
    } catch {
      // Silent fail - ultra tab just won't show data
    } finally {
      setEnhancedLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      fetchPrediction();
      fetchEnhanced();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children || (
          <Button className="w-full">
            <TrendingUp className="w-4 h-4 mr-2" />
            View Prediction
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="max-w-4xl max-h-[90vh] overflow-y-auto"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">
            Match Analysis & Prediction
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Match Info */}
          <div className="bg-muted/50 p-4 rounded-lg">
            <MatchCard match={match} showPrediction={false} />
          </div>

          {/* Prediction Content */}
          {loading && !enhancedData && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              <span>Analyzing match data and generating prediction...</span>
            </div>
          )}

          {error && !enhancedData && (
            <div className="text-center py-12">
              <div className="text-red-600 mb-2">Failed to generate prediction</div>
              <div className="text-sm text-muted-foreground mb-4">{error}</div>
              <Button onClick={() => {
                setPrediction(null);
                setAdvancedPrediction(null);
                setApiPredictions(null);
                setEnhancedData(null);
                fetchPrediction();
                fetchEnhanced();
              }}>
                Retry
              </Button>
            </div>
          )}

          {(advancedPrediction || apiPredictions || prediction || enhancedData) && !loading && (
            <Tabs defaultValue="ultra" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="ultra" className="text-xs">
                  <span className="material-symbols-outlined text-xs mr-1 align-middle">psychology</span>
                  Ultra Analiz
                </TabsTrigger>
                <TabsTrigger value="advanced" className="text-xs">Gelişmiş Analiz</TabsTrigger>
                <TabsTrigger value="api" className="text-xs">API Football</TabsTrigger>
              </TabsList>

              <TabsContent value="ultra" className="space-y-4">
                {enhancedLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin mr-2 text-emerald-500" />
                    <span className="text-sm text-muted-foreground">4 motor çalışıyor...</span>
                  </div>
                )}
                {enhancedData && <UltraAnalysisTab data={enhancedData} />}
                {!enhancedData && !enhancedLoading && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    Ultra analiz verisi yüklenemedi
                  </div>
                )}
              </TabsContent>

              <TabsContent value="advanced" className="space-y-4">
                {advancedPrediction ? (
                  <AdvancedPredictionCard
                    prediction={advancedPrediction}
                    homeTeamName={match.teams.home.name}
                    awayTeamName={match.teams.away.name}
                  />
                ) : prediction ? (
                  <PredictionCard
                    prediction={prediction}
                    homeTeamName={match.teams.home.name}
                    awayTeamName={match.teams.away.name}
                  />
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    Gelişmiş analiz bulunamadı
                  </div>
                )}
              </TabsContent>

              <TabsContent value="api" className="space-y-4">
                <ApiPredictionsCard
                  apiPredictions={apiPredictions}
                  homeTeamName={match.teams.home.name}
                  awayTeamName={match.teams.away.name}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
