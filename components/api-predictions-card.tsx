'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Target, Trophy, Shield, BarChart3,
  AlertCircle, Users, Clock, ChevronDown, ChevronUp,
  Info, HelpCircle, Flame,
} from 'lucide-react';

interface ApiPredictionsCardProps {
  apiPredictions: any;
  homeTeamName: string;
  awayTeamName: string;
}

type ConfidenceLabel = 'Çok Yüksek' | 'Yüksek' | 'Orta' | 'Düşük';

function confidenceFromPercent(p: number): ConfidenceLabel {
  if (p >= 70) return 'Çok Yüksek';
  if (p >= 58) return 'Yüksek';
  if (p >= 45) return 'Orta';
  return 'Düşük';
}

function confidenceStyle(c: ConfidenceLabel): string {
  switch (c) {
    case 'Çok Yüksek':
      return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    case 'Yüksek':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'Orta':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    default:
      return 'bg-rose-100 text-rose-800 border-rose-300';
  }
}

function translateWinnerComment(
  comment: string | undefined | null,
  winnerName?: string,
): string {
  if (!comment) return '';
  const c = comment.toLowerCase().trim();
  const winner = winnerName || '';
  if (c === 'win or draw' || c.includes('win or draw')) {
    return `${winner || 'Favori takım'} kazanır veya berabere kalır`;
  }
  if (c === 'win' || c === 'winner') return `${winner || 'Favori takım'} kazanır`;
  if (c === 'draw') return 'Berabere biter';
  if (c.includes('lose')) return `${winner || 'Takım'} kaybeder`;
  if (c.includes('no prediction')) return 'Tahmin yapılamıyor';
  return comment;
}

function interpretGoalLine(raw: string | number | null | undefined): {
  type: 'under' | 'over' | 'unknown';
  threshold: number;
  label: string;
} {
  if (raw === null || raw === undefined || raw === '') {
    return { type: 'unknown', threshold: 0, label: 'Veri yok' };
  }
  const s = String(raw).trim();
  const num = parseFloat(s);
  if (isNaN(num)) return { type: 'unknown', threshold: 0, label: 'Veri yok' };
  if (s.startsWith('-')) {
    const t = Math.abs(num);
    return { type: 'under', threshold: t, label: `Alt ${t}` };
  }
  return { type: 'over', threshold: num, label: `Üst ${num}` };
}

function getTeamAvgGoals(
  apiPredictions: any,
  side: 'home' | 'away',
): { scored: number; conceded: number } {
  const team = apiPredictions?.teams?.[side];
  const scored =
    parseFloat(team?.league?.goals?.for?.average?.total) ||
    parseFloat(team?.last_5?.goals?.for?.average) ||
    0;
  const conceded =
    parseFloat(team?.league?.goals?.against?.average?.total) ||
    parseFloat(team?.last_5?.goals?.against?.average) ||
    0;
  return { scored, conceded };
}

function computeExpectedGoals(apiPredictions: any): {
  home: number;
  away: number;
  total: number;
  hasData: boolean;
} {
  const homeStats = getTeamAvgGoals(apiPredictions, 'home');
  const awayStats = getTeamAvgGoals(apiPredictions, 'away');
  const hasData =
    homeStats.scored > 0 || homeStats.conceded > 0 || awayStats.scored > 0 || awayStats.conceded > 0;

  const expHome =
    homeStats.scored > 0 && awayStats.conceded > 0
      ? (homeStats.scored + awayStats.conceded) / 2
      : homeStats.scored || 0;
  const expAway =
    awayStats.scored > 0 && homeStats.conceded > 0
      ? (awayStats.scored + homeStats.conceded) / 2
      : awayStats.scored || 0;

  const h = Math.max(0, Math.round(expHome * 10) / 10);
  const a = Math.max(0, Math.round(expAway * 10) / 10);
  return { home: h, away: a, total: Math.round((h + a) * 10) / 10, hasData };
}

function computeH2HStats(h2h: any[] | undefined): {
  over25Percent: number;
  bttsPercent: number;
  avgGoals: number;
  sampleSize: number;
} {
  if (!h2h || h2h.length === 0) {
    return { over25Percent: 0, bttsPercent: 0, avgGoals: 0, sampleSize: 0 };
  }
  const sample = h2h.slice(0, 10);
  let over25 = 0;
  let btts = 0;
  let totalGoals = 0;
  sample.forEach((m: any) => {
    const tg = (m.goals?.home || 0) + (m.goals?.away || 0);
    totalGoals += tg;
    if (tg > 2.5) over25++;
    if ((m.goals?.home || 0) > 0 && (m.goals?.away || 0) > 0) btts++;
  });
  return {
    over25Percent: Math.round((over25 / sample.length) * 100),
    bttsPercent: Math.round((btts / sample.length) * 100),
    avgGoals: Math.round((totalGoals / sample.length) * 10) / 10,
    sampleSize: sample.length,
  };
}

export function ApiPredictionsCard({
  apiPredictions,
  homeTeamName,
  awayTeamName,
}: ApiPredictionsCardProps) {
  const [showDetails, setShowDetails] = useState(false);

  if (!apiPredictions) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-600">
            <Target className="w-5 h-5" />
            AwaStats Resmi Tahminleri
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <div className="text-muted-foreground mb-2">
              Bu maç için AwaStats resmi tahmin verisi bulunamadı
            </div>
            <div className="text-sm text-muted-foreground">
              AwaStats tüm maçlar için tahmin verisi sağlamayabilir
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!apiPredictions.predictions) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-600">
            <Target className="w-5 h-5" />
            AwaStats Resmi Tahminleri
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <div className="text-muted-foreground">Bu maç için tahmin verisi mevcut değil</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const predictions = apiPredictions.predictions;
  const comparison = apiPredictions.comparison;
  const h2h = apiPredictions.h2h as any[] | undefined;

  const homePct = parseInt((predictions.percent?.home || '0').replace('%', ''), 10) || 0;
  const drawPct = parseInt((predictions.percent?.draw || '0').replace('%', ''), 10) || 0;
  const awayPct = parseInt((predictions.percent?.away || '0').replace('%', ''), 10) || 0;

  const winnerIsHome = predictions.winner?.name === homeTeamName;
  const winnerIsAway = predictions.winner?.name === awayTeamName;
  const winnerName = winnerIsHome ? homeTeamName : winnerIsAway ? awayTeamName : null;
  const winnerPct = winnerIsHome ? homePct : winnerIsAway ? awayPct : Math.max(homePct, awayPct);
  const winnerConfidence = confidenceFromPercent(winnerPct);
  const winnerCommentTr = translateWinnerComment(
    predictions.winner?.comment,
    winnerName || undefined,
  );

  const exp = computeExpectedGoals(apiPredictions);
  const overUnder = interpretGoalLine(predictions.under_over);

  // Ana Üst/Alt kararı: önce API'nin under_over'ı, yoksa xG'den hesapla
  const goalDecision: {
    label: string;
    rationale: string;
    confidence: ConfidenceLabel;
    direction: 'over' | 'under' | 'unknown';
  } = (() => {
    if (overUnder.type !== 'unknown') {
      const dir = overUnder.type;
      const reason =
        dir === 'over'
          ? `AwaStats modeli ${overUnder.threshold} golden fazla olmasını bekliyor (yaklaşık ${exp.total} gol).`
          : `AwaStats modeli ${overUnder.threshold} golden az olmasını bekliyor (yaklaşık ${exp.total} gol).`;
      const conf = exp.hasData
        ? Math.abs(exp.total - overUnder.threshold) > 0.7
          ? 'Yüksek'
          : 'Orta'
        : 'Orta';
      return { label: overUnder.label, rationale: reason, confidence: conf, direction: dir };
    }
    if (!exp.hasData) {
      return {
        label: 'Tahmin edilemiyor',
        rationale: 'Yeterli takım istatistiği yok.',
        confidence: 'Düşük',
        direction: 'unknown',
      };
    }
    const dir: 'over' | 'under' = exp.total >= 2.5 ? 'over' : 'under';
    return {
      label: dir === 'over' ? 'Üst 2.5 (çok gol)' : 'Alt 2.5 (az gol)',
      rationale: `Takımların sezon ortalamalarına göre ~${exp.total} gol bekleniyor.`,
      confidence: Math.abs(exp.total - 2.5) > 0.7 ? 'Yüksek' : 'Orta',
      direction: dir,
    };
  })();

  // Karşılıklı Gol kararı: her iki takım da >= 0.8 xG bekliyorsa "Var"
  const bttsDecision: {
    label: 'Var' | 'Yok' | 'Tahmin edilemiyor';
    rationale: string;
    confidence: ConfidenceLabel;
  } = (() => {
    if (!exp.hasData) {
      return {
        label: 'Tahmin edilemiyor',
        rationale: 'Yeterli takım istatistiği yok.',
        confidence: 'Düşük',
      };
    }
    const both = exp.home >= 0.9 && exp.away >= 0.9;
    if (both) {
      return {
        label: 'Var',
        rationale: `Her iki takım da gol atma eğiliminde (${homeTeamName} ~${exp.home}, ${awayTeamName} ~${exp.away}).`,
        confidence: exp.home >= 1.2 && exp.away >= 1.2 ? 'Yüksek' : 'Orta',
      };
    }
    const weaker = exp.home < exp.away ? homeTeamName : awayTeamName;
    const weakerVal = Math.min(exp.home, exp.away);
    return {
      label: 'Yok',
      rationale: `${weaker} çok az gol atıyor (~${weakerVal}). Tek takımın gol atması daha olası.`,
      confidence: weakerVal < 0.5 ? 'Yüksek' : 'Orta',
    };
  })();

  const h2hStats = computeH2HStats(h2h);

  return (
    <div className="space-y-6">
      {/* =================== TEK BAKIŞTA ÖZET =================== */}
      <Card className="border-2 border-orange-200">
        <CardHeader className="bg-gradient-to-r from-orange-50 to-amber-50">
          <CardTitle className="flex items-center gap-2 text-orange-700">
            <Flame className="w-5 h-5" />
            Tek Bakışta Sonuç
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Bu maçta muhtemelen ne olacağının kısa özeti
          </p>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Kazanan */}
            <div className="p-4 rounded-lg bg-muted/40 border">
              <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                <Trophy className="w-3.5 h-3.5" />
                Kim kazanır?
              </div>
              <div className="text-2xl font-bold text-orange-600 mb-1">
                {winnerName || 'Belirsiz'}
              </div>
              <div className="text-sm text-muted-foreground mb-3">
                {winnerName ? `%${winnerPct} ihtimal` : 'Açık sonuç'}
              </div>
              <Badge className={`${confidenceStyle(winnerConfidence)} border`}>
                Güven: {winnerConfidence}
              </Badge>
              {winnerCommentTr && (
                <p className="text-xs text-muted-foreground mt-2 italic">
                  {winnerCommentTr}
                </p>
              )}
            </div>

            {/* Kaç gol */}
            <div className="p-4 rounded-lg bg-muted/40 border">
              <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                <Target className="w-3.5 h-3.5" />
                Kaç gol olur?
              </div>
              <div className="text-2xl font-bold text-orange-600 mb-1">{goalDecision.label}</div>
              <div className="text-sm text-muted-foreground mb-3">
                Beklenen toplam: ~{exp.total} gol
              </div>
              <Badge className={`${confidenceStyle(goalDecision.confidence)} border`}>
                Güven: {goalDecision.confidence}
              </Badge>
              <p className="text-xs text-muted-foreground mt-2">{goalDecision.rationale}</p>
            </div>

            {/* Karşılıklı gol */}
            <div className="p-4 rounded-lg bg-muted/40 border">
              <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                <Users className="w-3.5 h-3.5" />
                İki takım da gol atar mı?
              </div>
              <div className="text-2xl font-bold text-orange-600 mb-1">{bttsDecision.label}</div>
              <div className="text-sm text-muted-foreground mb-3">
                {exp.hasData ? `${homeTeamName} ~${exp.home} / ${awayTeamName} ~${exp.away}` : '—'}
              </div>
              <Badge className={`${confidenceStyle(bttsDecision.confidence)} border`}>
                Güven: {bttsDecision.confidence}
              </Badge>
              <p className="text-xs text-muted-foreground mt-2">{bttsDecision.rationale}</p>
            </div>
          </div>

          {h2hStats.sampleSize >= 3 && (
            <div className="mt-5 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-blue-900">
                  <span className="font-semibold">Geçmiş veri:</span> Son {h2hStats.sampleSize}{' '}
                  karşılaşmada maç başına ortalama <b>{h2hStats.avgGoals}</b> gol atıldı,{' '}
                  <b>%{h2hStats.over25Percent}</b>'i 2.5 üst gol, <b>%{h2hStats.bttsPercent}</b>'inde
                  iki takım da gol attı.
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* =================== KAZANMA OLASILIKLARI =================== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Kazanma Olasılıkları
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            AwaStats'in her sonuç için verdiği yüzde
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600">{homePct}%</div>
              <div className="text-sm font-medium mt-1">{homeTeamName}</div>
              <div className="text-xs text-muted-foreground mb-2">Ev sahibi</div>
              <Progress value={homePct} className="h-2" />
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-gray-500">{drawPct}%</div>
              <div className="text-sm font-medium mt-1">Berabere</div>
              <div className="text-xs text-muted-foreground mb-2">&nbsp;</div>
              <Progress value={drawPct} className="h-2" />
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-rose-600">{awayPct}%</div>
              <div className="text-sm font-medium mt-1">{awayTeamName}</div>
              <div className="text-xs text-muted-foreground mb-2">Deplasman</div>
              <Progress value={awayPct} className="h-2" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* =================== TAKIM KARŞILAŞTIRMASI =================== */}
      {comparison && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Takım Karşılaştırması
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Her alanda hangi takım daha güçlü (AwaStats verileri)
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                {
                  label: 'Form',
                  hint: 'Son maçlardaki performans',
                  h: comparison.form?.home,
                  a: comparison.form?.away,
                },
                {
                  label: 'Atak Gücü',
                  hint: 'Gol atma kapasitesi',
                  h: comparison.att?.home,
                  a: comparison.att?.away,
                },
                {
                  label: 'Defans Gücü',
                  hint: 'Gol yememe kapasitesi',
                  h: comparison.def?.home,
                  a: comparison.def?.away,
                },
                {
                  label: 'Toplam Güç',
                  hint: 'Genel takım gücü',
                  h: comparison.total?.home,
                  a: comparison.total?.away,
                },
              ].map((stat, idx) => {
                const hv = parseFloat(stat.h) || 0;
                const av = parseFloat(stat.a) || 0;
                const max = Math.max(hv, av) || 1;
                const hp = (hv / max) * 100;
                const ap = (av / max) * 100;
                const leader =
                  hv > av ? homeTeamName : av > hv ? awayTeamName : 'Eşit';
                return (
                  <div key={idx} className="space-y-2">
                    <div className="flex justify-between items-baseline text-sm">
                      <div>
                        <span className="font-semibold">{stat.label}</span>
                        <span className="text-xs text-muted-foreground ml-2">({stat.hint})</span>
                      </div>
                      <span className="text-xs font-medium text-muted-foreground">
                        {leader === 'Eşit' ? 'Eşit' : `${leader} üstün`}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs truncate">{homeTeamName}</span>
                          <Badge variant={hv > av ? 'default' : 'outline'}>
                            {stat.h || '—'}
                          </Badge>
                        </div>
                        <Progress value={hp} className="h-1.5" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={av > hv ? 'default' : 'outline'}>
                            {stat.a || '—'}
                          </Badge>
                          <span className="text-xs truncate">{awayTeamName}</span>
                        </div>
                        <Progress value={ap} className="h-1.5" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* =================== SON KARŞILAŞMALAR =================== */}
      {h2h && h2h.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Son Karşılaşmalar (H2H)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Bu iki takımın geçmişte oynadığı son maçlar
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {h2h.slice(0, 5).map((m: any, i: number) => {
                const hg = m.goals?.home || 0;
                const ag = m.goals?.away || 0;
                const tg = hg + ag;
                const btts = hg > 0 && ag > 0;
                const draw = hg === ag;
                return (
                  <div
                    key={i}
                    className="flex justify-between items-center p-3 bg-muted/40 rounded-lg"
                  >
                    <div className="text-sm min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {m.teams?.home?.name} vs {m.teams?.away?.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {m.fixture?.date
                          ? new Date(m.fixture.date).toLocaleDateString('tr-TR')
                          : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="font-bold text-lg tabular-nums">
                        {hg} - {ag}
                      </div>
                      <div className="flex gap-1">
                        <Badge
                          variant={tg > 2.5 ? 'default' : 'outline'}
                          className="text-xs"
                          title={tg > 2.5 ? '2.5 üstü gol' : '2.5 altı gol'}
                        >
                          {tg > 2.5 ? 'Ü2.5' : 'A2.5'}
                        </Badge>
                        <Badge
                          variant={btts ? 'default' : 'outline'}
                          className="text-xs"
                          title={
                            btts ? 'İki takım da gol attı' : 'En az bir takım gol atamadı'
                          }
                        >
                          {btts ? 'KG Var' : 'KG Yok'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* =================== DETAYLAR (katlanabilir) =================== */}
      <Card>
        <CardHeader className="cursor-pointer" onClick={() => setShowDetails((s) => !s)}>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-muted-foreground">
              <HelpCircle className="w-5 h-5" />
              Ham API Verisi ve Teknik Detaylar
            </span>
            {showDetails ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            AwaStats'ın döndüğü ham değerler — ileri analiz için
          </p>
        </CardHeader>
        {showDetails && (
          <CardContent className="pt-0">
            <Separator className="mb-4" />
            <div className="space-y-4 text-sm">
              <div>
                <div className="font-semibold mb-2">Gol Formatı Açıklaması</div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>
                    <b>Alt/Üst ({overUnder.label}):</b>{' '}
                    {overUnder.type === 'under'
                      ? `Modele göre toplam gol ${overUnder.threshold}'un altında kalır.`
                      : overUnder.type === 'over'
                        ? `Modele göre toplam gol ${overUnder.threshold}'un üstünde olur.`
                        : 'AwaStats bu maç için alt/üst tahmini vermedi.'}
                  </p>
                  <p>
                    <b>Takım ortalamaları:</b> {homeTeamName} lig ortalamasında{' '}
                    {getTeamAvgGoals(apiPredictions, 'home').scored.toFixed(2)} gol atıyor,{' '}
                    {getTeamAvgGoals(apiPredictions, 'home').conceded.toFixed(2)} yiyor.{' '}
                    {awayTeamName} ise {getTeamAvgGoals(apiPredictions, 'away').scored.toFixed(2)}{' '}
                    atıyor, {getTeamAvgGoals(apiPredictions, 'away').conceded.toFixed(2)} yiyor.
                  </p>
                </div>
              </div>

              {predictions?.advice && (
                <div>
                  <div className="font-semibold mb-1">AwaStats Önerisi (orijinal):</div>
                  <div className="text-xs p-2 bg-muted/50 rounded font-mono">
                    {predictions.advice}
                  </div>
                </div>
              )}

              {h2hStats.sampleSize > 0 && (
                <div>
                  <div className="font-semibold mb-2">H2H Özet İstatistik</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="p-2 bg-muted/40 rounded text-center">
                      <div className="font-bold">%{h2hStats.over25Percent}</div>
                      <div className="text-muted-foreground">Üst 2.5</div>
                    </div>
                    <div className="p-2 bg-muted/40 rounded text-center">
                      <div className="font-bold">%{100 - h2hStats.over25Percent}</div>
                      <div className="text-muted-foreground">Alt 2.5</div>
                    </div>
                    <div className="p-2 bg-muted/40 rounded text-center">
                      <div className="font-bold">%{h2hStats.bttsPercent}</div>
                      <div className="text-muted-foreground">KG Var</div>
                    </div>
                    <div className="p-2 bg-muted/40 rounded text-center">
                      <div className="font-bold">{h2hStats.avgGoals}</div>
                      <div className="text-muted-foreground">Ort. Gol</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* =================== LİG =================== */}
      {apiPredictions.league && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              {apiPredictions.league.logo && (
                <img
                  src={apiPredictions.league.logo}
                  alt={apiPredictions.league.name}
                  className="w-10 h-10 object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              <div>
                <div className="font-semibold">{apiPredictions.league.name}</div>
                <div className="text-xs text-muted-foreground">
                  Sezon {apiPredictions.league.season}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
