'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sparkles, Target, Activity, Loader2, TrendingUp, Gauge } from 'lucide-react';

interface AnalysisResult {
  fixtureId: number;
  homeName: string;
  awayName: string;
  leagueName: string;
  country: string;
  kickoffUtc: string;
  statusShort: string;
  elapsed: number | null;
  bucket: 'live_0_0' | 'upcoming';
  xgHome: number;
  xgAway: number;
  xgTotal: number;
  poissonOver05: number;
  poissonOver15: number;
  poissonOver25: number;
  poissonOver35: number;
  poissonBTTS: number;
  poissonHTOver05: number;
  poissonHTOver15: number;
  poissonExactScore: string;
  oddOver25: number | null;
  oddOver15: number | null;
  oddBTTS: number | null;
  impliedOver25: number | null;
  impliedBTTS: number | null;
  h2hGoalAvg: number | null;
  h2hMatches: number;
  oddHTOver05: number | null;
  oddHTOver15: number | null;
  oddHTBTTS: number | null;
  supportO25: { poisson: boolean; odds: boolean; h2h: boolean; advice: boolean; probet: boolean; patterns: boolean; count: number };
  supportBTTS: { poisson: boolean; odds: boolean; h2h: boolean; probet: boolean; patterns: boolean; count: number };
  supportHT05: { poisson: boolean; odds: boolean; probet: boolean; patterns: boolean; count: number };
  probetO25Prob: number | null;
  probetBTTSProb: number | null;
  probetHT05Prob: number | null;
  probetBestPick: { label: string; prob: number; odds: number | null } | null;
  matchedPatterns: Array<{ id: string; name: string; prediction: string; hitRate: number; banko: boolean }>;
  h2hBttsRate: number | null;
  predictionAdvice: string;
  underOverHint: string | null;
  confidence: number;
  patterns: string[];
  recommendation: string;
  hasBet365: boolean;
  bet365MarketsCount: number;
}

interface AnalyzerResponse {
  success: boolean;
  data?: {
    date: string;
    totalCandidates: number;
    analyzed: number;
    bet365Only?: boolean;
    bet365Excluded?: number;
    night: AnalysisResult[];
    tomorrow: AnalysisResult[];
    meta: { fetchedAt: string; durationMs: number };
  };
  error?: string;
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    const hh = d.getUTCHours().toString().padStart(2, '0');
    const mm = d.getUTCMinutes().toString().padStart(2, '0');
    return `${hh}:${mm} UTC`;
  } catch { return iso.slice(11, 16); }
}

function confidenceColor(c: number) {
  if (c >= 75) return 'bg-emerald-500 text-white';
  if (c >= 60) return 'bg-amber-500 text-white';
  if (c >= 45) return 'bg-sky-500 text-white';
  return 'bg-slate-400 text-white';
}

function SupportBlock({ label, total, count, rows }: {
  label: string; total: number; count: number; rows: [string, boolean][]
}) {
  const full = count === total;
  const strong = count >= total - 1 && count > 0;
  const bg = full
    ? 'bg-emerald-100 dark:bg-emerald-900/40 border-emerald-400'
    : strong
    ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-300'
    : 'bg-slate-50 dark:bg-slate-800 border-slate-200';
  return (
    <div className={`rounded border px-1.5 py-1 ${bg}`}>
      <div className="flex items-center justify-between font-semibold">
        <span>{label}</span>
        <span className={full ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'}>
          {count}/{total}{full ? ' 🎯' : ''}
        </span>
      </div>
      <div className="mt-0.5 space-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between">
            <span className="text-slate-500">{k}</span>
            <span className={v ? 'text-emerald-600' : 'text-slate-400'}>{v ? '✓' : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchCard({ r }: { r: AnalysisResult }) {
  const liveTag = r.bucket === 'live_0_0';
  return (
    <div className="border rounded-lg p-3 bg-white dark:bg-slate-900 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {liveTag ? (
              <Badge className="bg-red-600 text-white">{r.elapsed}' CANLI 0-0</Badge>
            ) : (
              <Badge variant="outline">{formatTime(r.kickoffUtc)}</Badge>
            )}
            <span className="text-xs text-slate-500 truncate">{r.leagueName} · {r.country}</span>
          </div>
          <div className="font-semibold text-sm truncate">{r.homeName} <span className="text-slate-400">v</span> {r.awayName}</div>
        </div>
        <div className={`px-2 py-1 rounded-md font-bold text-sm ${confidenceColor(r.confidence)}`}>
          {r.confidence.toFixed(0)}%
        </div>
      </div>

      {/* ── TAVSİYE (kartın üstünde büyük, karar verici) ───────────────── */}
      <div className="mt-3 rounded-lg border-2 border-emerald-500 bg-gradient-to-r from-emerald-50 to-emerald-100/60 dark:from-emerald-950/50 dark:to-emerald-900/30 px-3 py-2.5 flex items-center gap-3 shadow-sm">
        <div className="text-emerald-600 dark:text-emerald-400 text-3xl leading-none">✓</div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-widest font-semibold text-emerald-700/80 dark:text-emerald-300/80">
            Tavsiye
          </div>
          <div className="text-lg sm:text-xl md:text-2xl font-extrabold text-emerald-900 dark:text-emerald-100 leading-tight truncate">
            {r.recommendation}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-1 mt-3 text-center text-[11px]">
        <div className="bg-amber-50 dark:bg-amber-900/30 rounded px-1 py-1">
          <div className="text-amber-700 dark:text-amber-300">İY 0.5</div>
          <div className="font-bold text-amber-700 dark:text-amber-200">{r.poissonHTOver05.toFixed(0)}%</div>
        </div>
        <div className="bg-slate-50 dark:bg-slate-800 rounded px-1 py-1">
          <div className="text-slate-500">0.5 Üst</div>
          <div className="font-bold">{r.poissonOver05.toFixed(0)}%</div>
        </div>
        <div className="bg-slate-50 dark:bg-slate-800 rounded px-1 py-1">
          <div className="text-slate-500">1.5 Üst</div>
          <div className="font-bold">{r.poissonOver15.toFixed(0)}%</div>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/30 rounded px-1 py-1">
          <div className="text-emerald-700 dark:text-emerald-300">2.5 Üst</div>
          <div className="font-bold text-emerald-700 dark:text-emerald-200">{r.poissonOver25.toFixed(0)}%</div>
        </div>
        <div className="bg-slate-50 dark:bg-slate-800 rounded px-1 py-1">
          <div className="text-slate-500">3.5 Üst</div>
          <div className="font-bold">{r.poissonOver35.toFixed(0)}%</div>
        </div>
        <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded px-1 py-1">
          <div className="text-indigo-700 dark:text-indigo-300">KG Var</div>
          <div className="font-bold text-indigo-700 dark:text-indigo-200">{r.poissonBTTS.toFixed(0)}%</div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1 items-center text-xs">
        <span className="text-slate-500">xG:</span>
        <span className="font-mono">{r.xgHome.toFixed(1)} + {r.xgAway.toFixed(1)} = <b>{r.xgTotal.toFixed(1)}</b></span>
        <span className="text-slate-500 ml-2">Poisson modu:</span>
        <span className="font-mono font-bold">{r.poissonExactScore}</span>
        {r.h2hGoalAvg !== null && (
          <>
            <span className="text-slate-500 ml-2">H2H:</span>
            <span className="font-mono">{r.h2hGoalAvg.toFixed(2)} <span className="text-slate-400">({r.h2hMatches}m)</span></span>
          </>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1 items-center text-xs">
        {r.hasBet365 && (
          <Badge className="bg-[#007b5b] text-white font-bold">Bet365 ✓ ({r.bet365MarketsCount} mkt)</Badge>
        )}
        {r.oddOver25 !== null && (
          <Badge variant="secondary" className="font-mono">B365 O2.5 @ {r.oddOver25.toFixed(2)}</Badge>
        )}
        {r.oddOver15 !== null && (
          <Badge variant="secondary" className="font-mono">B365 O1.5 @ {r.oddOver15.toFixed(2)}</Badge>
        )}
        {r.oddBTTS !== null && (
          <Badge variant="secondary" className="font-mono">B365 KG @ {r.oddBTTS.toFixed(2)}</Badge>
        )}
        {r.oddHTOver05 !== null && (
          <Badge variant="secondary" className="font-mono">B365 İY0.5 @ {r.oddHTOver05.toFixed(2)}</Badge>
        )}
        {r.oddHTOver15 !== null && r.oddHTOver05 === null && (
          <Badge variant="secondary" className="font-mono">B365 İY1.5 @ {r.oddHTOver15.toFixed(2)}</Badge>
        )}
      </div>

      {/* Market-bazlı 6-kaynak sağlama */}
      <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
        <SupportBlock label="Üst 2.5" total={6} count={r.supportO25.count}
          rows={[
            ['Poisson', r.supportO25.poisson],
            ['B365 Oran', r.supportO25.odds],
            ['H2H Ort.', r.supportO25.h2h],
            ['AI Advice', r.supportO25.advice],
            ['ProBet Eng.', r.supportO25.probet],
            ['ProBet Ptrn', r.supportO25.patterns],
          ]} />
        <SupportBlock label="KG Var" total={5} count={r.supportBTTS.count}
          rows={[
            ['Poisson', r.supportBTTS.poisson],
            ['B365 Oran', r.supportBTTS.odds],
            ['H2H KG%', r.supportBTTS.h2h],
            ['ProBet Eng.', r.supportBTTS.probet],
            ['ProBet Ptrn', r.supportBTTS.patterns],
          ]} />
        <SupportBlock label="İY 0.5 Üst" total={4} count={r.supportHT05.count}
          rows={[
            ['Poisson HT', r.supportHT05.poisson],
            ['B365 İY', r.supportHT05.odds],
            ['ProBet Eng.', r.supportHT05.probet],
            ['ProBet Ptrn', r.supportHT05.patterns],
          ]} />
      </div>

      {r.matchedPatterns && r.matchedPatterns.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {r.matchedPatterns.filter(p => p.banko).slice(0, 4).map((p) => (
            <Badge key={p.id} className="bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white text-[10px]">
              📊 {p.name} · %{(p.hitRate * 100).toFixed(0)}
            </Badge>
          ))}
        </div>
      )}

      {r.patterns.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {r.patterns.map((p) => (
            <Badge key={p} className="bg-gradient-to-r from-amber-500 to-orange-600 text-white text-[10px]">
              🎯 {p}
            </Badge>
          ))}
        </div>
      )}

    </div>
  );
}

export function GoalAnalyzerPanel() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalyzerResponse['data'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch(`/api/goal-analyzer?date=${today}&includeTomorrow=true&topN=20&deep=60`, {
        cache: 'no-store',
      });
      const json: AnalyzerResponse = await res.json();
      if (!json.success || !json.data) throw new Error(json.error || 'Analiz başarısız');
      setData(json.data);
    } catch (e: any) {
      setError(e?.message || 'Beklenmeyen hata');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="lg"
          className="bg-gradient-to-r from-amber-500 via-orange-600 to-red-600 hover:from-amber-600 hover:via-orange-700 hover:to-red-700 text-white font-bold shadow-lg border-0"
          onClick={() => { if (!data && !loading) run(); }}
        >
          <Sparkles className="w-5 h-5 mr-2" />
          Günün En İyi Gol Analizi
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Target className="w-5 h-5 text-orange-600" />
            Gol Analizi — Poisson + Oran Konsensüsü + H2H + Value Bet
            <Button size="sm" variant="outline" className="ml-auto" onClick={run} disabled={loading}>
              {loading ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Hesaplanıyor…</> : 'Yenile'}
            </Button>
          </DialogTitle>
        </DialogHeader>

        {loading && !data && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-10 h-10 animate-spin text-orange-600" />
            <div className="text-sm text-slate-500">
              500+ fikstür taranıyor, Poisson + odds + H2H hesaplanıyor… (~20-40 sn)
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-lg text-red-700 dark:text-red-300">
            Hata: {error}
          </div>
        )}

        {data && (
          <div>
            <div className="grid grid-cols-5 gap-3 mb-4">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <div className="text-xs text-slate-500 flex items-center gap-1"><Activity className="w-3 h-3" />Taranan</div>
                <div className="text-2xl font-bold">{data.totalCandidates}</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <div className="text-xs text-slate-500 flex items-center gap-1"><Gauge className="w-3 h-3" />Analiz</div>
                <div className="text-2xl font-bold">{data.analyzed}</div>
              </div>
              <div className="bg-rose-50 dark:bg-rose-900/30 rounded-lg p-3">
                <div className="text-xs text-rose-700 dark:text-rose-300">Bet365 Dışı</div>
                <div className="text-2xl font-bold text-rose-600">{data.bet365Excluded ?? 0}</div>
                <div className="text-[10px] text-rose-500">filtrelendi</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <div className="text-xs text-slate-500 flex items-center gap-1"><TrendingUp className="w-3 h-3" />Bu Gece</div>
                <div className="text-2xl font-bold text-red-600">{data.night.length}</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <div className="text-xs text-slate-500 flex items-center gap-1"><Sparkles className="w-3 h-3" />Yarın</div>
                <div className="text-2xl font-bold text-indigo-600">{data.tomorrow.length}</div>
              </div>
            </div>

            <Tabs defaultValue="night" className="w-full">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="night">🌙 Bu Gece ({data.night.length})</TabsTrigger>
                <TabsTrigger value="tomorrow">📅 Yarın ({data.tomorrow.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="night">
                {data.night.length === 0 && <div className="text-center text-slate-500 py-8">Gece için veri bulunamadı.</div>}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                  {data.night.map((r) => <MatchCard key={r.fixtureId} r={r} />)}
                </div>
              </TabsContent>
              <TabsContent value="tomorrow">
                {data.tomorrow.length === 0 && <div className="text-center text-slate-500 py-8">Yarın için henüz tahmin üretilmemiş.</div>}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                  {data.tomorrow.map((r) => <MatchCard key={r.fixtureId} r={r} />)}
                </div>
              </TabsContent>
            </Tabs>

            <div className="mt-4 text-[11px] text-slate-500 flex items-center justify-between">
              <span>İşlem süresi: {(data.meta.durationMs / 1000).toFixed(1)}s</span>
              <span>Güncellendi: {new Date(data.meta.fetchedAt).toLocaleString('tr-TR')}</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
