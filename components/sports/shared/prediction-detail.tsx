'use client';

import { useState, useEffect } from 'react';
import { SportType } from '@/lib/sports/base/types';

interface PredictionDetailProps {
  sport: SportType;
  gameId: string;
  apiPath: string;
  accentColor: string;
  icon: string;
}

const tierColors: Record<string, string> = {
  platinum: 'bg-gradient-to-r from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-600 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-500',
  gold: 'bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 text-amber-800 dark:text-amber-300 border border-amber-300/50 dark:border-amber-600/40',
  silver: 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
};

export function PredictionDetail({ sport, gameId, apiPath, accentColor, icon }: PredictionDetailProps) {
  const [prediction, setPrediction] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPrediction = async () => {
      try {
        const res = await fetch(apiPath);
        const data = await res.json();
        if (data.success) {
          setPrediction(data.data);
        } else {
          setError(data.error || 'Tahmin yuklenemedi');
        }
      } catch {
        setError('Baglanti hatasi');
      } finally {
        setLoading(false);
      }
    };
    fetchPrediction();
  }, [apiPath]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-10 h-10 border-[3px] border-slate-200 dark:border-slate-700 border-t-slate-500 dark:border-t-slate-400 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white dark:bg-slate-800/80 border border-red-200 dark:border-red-800/50 rounded-xl p-6 shadow-sm">
          <h2 className="font-semibold text-sm text-red-600 dark:text-red-400 mb-1">Hata</h2>
          <p className="text-sm text-slate-700 dark:text-slate-300">{error}</p>
        </div>
      </div>
    );
  }

  if (!prediction) return null;

  const game = prediction.game;
  const matchResult = prediction.match_result;
  const highBets = prediction.high_confidence_bets || [];
  const medBets = prediction.medium_risk_bets || [];
  const highRiskBets = prediction.high_risk_bets || [];

  const confidenceValue = prediction.prediction_confidence || matchResult?.confidence || 0;
  const getConfidenceBarColor = (val: number) => {
    if (val >= 70) return 'bg-emerald-500';
    if (val >= 50) return 'bg-amber-500';
    return 'bg-red-500';
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {/* Game Header */}
      <div className="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xl">{icon}</span>
          <span className="text-xs text-muted-foreground">
            {game?.league?.name || prediction.league_name || 'Lig'}
          </span>
          {prediction.confidence_tier && (
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${tierColors[prediction.confidence_tier] || ''}`}>
              {prediction.confidence_tier?.toUpperCase()}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {(game?.teams?.home?.logo || prediction.home_logo) && (
              <img src={game?.teams?.home?.logo || prediction.home_logo} alt="" className="w-10 h-10 object-contain" />
            )}
            <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {game?.teams?.home?.name || prediction.home_team || 'Ev Sahibi'}
            </span>
          </div>
          <span className="text-2xl font-bold text-slate-300 dark:text-slate-600">vs</span>
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {game?.teams?.away?.name || prediction.away_team || 'Deplasman'}
            </span>
            {(game?.teams?.away?.logo || prediction.away_logo) && (
              <img src={game?.teams?.away?.logo || prediction.away_logo} alt="" className="w-10 h-10 object-contain" />
            )}
          </div>
        </div>

        {/* Confidence Bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">Tahmin Guveni</span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">%{Math.round(confidenceValue)}</span>
          </div>
          <div className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full">
            <div
              className={`h-2 rounded-full transition-all ${getConfidenceBarColor(confidenceValue)}`}
              style={{ width: `${Math.min(100, confidenceValue)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Match Result Probabilities */}
      {matchResult && (
        <div className="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5">
          <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 mb-4">Mac Sonucu Olasiliklari</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="text-center p-3 bg-slate-50 dark:bg-slate-700/40 rounded-lg border border-slate-100 dark:border-slate-700">
              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                %{typeof matchResult.home_win === 'object' ? matchResult.home_win.probability : matchResult.home_win}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Ev Sahibi</div>
              {typeof matchResult.home_win === 'object' && (
                <div className="text-xs text-muted-foreground mt-0.5">Oran: {matchResult.home_win.odds}</div>
              )}
            </div>
            {matchResult.draw && (
              <div className="text-center p-3 bg-slate-50 dark:bg-slate-700/40 rounded-lg border border-slate-100 dark:border-slate-700">
                <div className="text-xl font-bold text-slate-600 dark:text-slate-300">
                  %{typeof matchResult.draw === 'object' ? matchResult.draw.probability : matchResult.draw}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Beraberlik</div>
                {typeof matchResult.draw === 'object' && (
                  <div className="text-xs text-muted-foreground mt-0.5">Oran: {matchResult.draw.odds}</div>
                )}
              </div>
            )}
            <div className="text-center p-3 bg-slate-50 dark:bg-slate-700/40 rounded-lg border border-slate-100 dark:border-slate-700">
              <div className="text-xl font-bold text-red-500 dark:text-red-400">
                %{typeof matchResult.away_win === 'object' ? matchResult.away_win.probability : matchResult.away_win}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Deplasman</div>
              {typeof matchResult.away_win === 'object' && (
                <div className="text-xs text-muted-foreground mt-0.5">Oran: {matchResult.away_win.odds}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* High Confidence Bets */}
      {highBets.length > 0 && (
        <div className="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5">
          <h3 className="font-semibold text-sm text-emerald-700 dark:text-emerald-400 mb-3">
            Yuksek Guvenli Tahminler
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {highBets.map((bet: any, i: number) => (
              <div key={i} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{bet.title}</span>
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">%{bet.confidence}</span>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300">{bet.description}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{bet.reason}</p>
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mt-1">{bet.recommendation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Medium Risk Bets */}
      {medBets.length > 0 && (
        <div className="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5">
          <h3 className="font-semibold text-sm text-amber-700 dark:text-amber-400 mb-3">
            Orta Risk Tahminler
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {medBets.map((bet: any, i: number) => (
              <div key={i} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{bet.title}</span>
                  <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">%{bet.confidence}</span>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300">{bet.description}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{bet.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* High Risk Bets */}
      {highRiskBets.length > 0 && (
        <div className="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5">
          <h3 className="font-semibold text-sm text-red-700 dark:text-red-400 mb-3">
            Yuksek Risk / Yuksek Oranli Tahminler
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {highRiskBets.map((bet: any, i: number) => (
              <div key={i} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{bet.title}</span>
                  <span className="text-xs font-semibold text-red-600 dark:text-red-400">%{bet.confidence}</span>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300">{bet.description}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{bet.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Additional Markets */}
      {prediction.total_points && (
        <div className="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5">
          <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 mb-3">Alt/Ust Tahminleri</h3>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(prediction.total_points || prediction.total_goals || {}).map(([key, value]: [string, any]) => (
              <div key={key} className="flex items-center justify-between py-2.5 px-3 bg-slate-50 dark:bg-slate-700/40 rounded-lg border border-slate-100 dark:border-slate-700">
                <span className="text-xs text-muted-foreground">
                  {key.replace(/_/g, ' ').replace('under', 'Alt').replace('over', 'Ust')}
                </span>
                <span className="font-semibold text-xs text-slate-900 dark:text-slate-100">
                  %{typeof value === 'object' ? value.probability : value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
