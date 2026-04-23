
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
  platinum: 'bg-gradient-to-r from-gray-200 to-gray-400 text-gray-800 border-gray-400',
  gold: 'bg-gradient-to-r from-yellow-300 to-yellow-500 text-yellow-900 border-yellow-500',
  silver: 'bg-gradient-to-r from-gray-300 to-gray-400 text-gray-700 border-gray-400',
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
        <div className="w-12 h-12 border-4 border-gray-200 border-t-current rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 text-red-700 dark:text-red-400">
          <h2 className="font-bold mb-2">Hata</h2>
          <p>{error}</p>
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

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Game Header */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">{icon}</span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {game?.league?.name || prediction.league_name || 'Lig'}
          </span>
          {prediction.confidence_tier && (
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${tierColors[prediction.confidence_tier] || ''}`}>
              {prediction.confidence_tier?.toUpperCase()}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {(game?.teams?.home?.logo || prediction.home_logo) && (
              <img src={game?.teams?.home?.logo || prediction.home_logo} alt="" className="w-12 h-12 object-contain" />
            )}
            <span className="text-xl font-bold text-gray-900 dark:text-white">
              {game?.teams?.home?.name || prediction.home_team || 'Ev Sahibi'}
            </span>
          </div>
          <span className="text-3xl font-bold text-gray-300 dark:text-gray-600">vs</span>
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-gray-900 dark:text-white">
              {game?.teams?.away?.name || prediction.away_team || 'Deplasman'}
            </span>
            {(game?.teams?.away?.logo || prediction.away_logo) && (
              <img src={game?.teams?.away?.logo || prediction.away_logo} alt="" className="w-12 h-12 object-contain" />
            )}
          </div>
        </div>

        {/* Confidence Bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-gray-500">Tahmin Guveni</span>
            <span className="font-bold">%{prediction.prediction_confidence || Math.round((matchResult?.confidence || 0))}
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full bg-gradient-to-r from-${accentColor}-400 to-${accentColor}-600`}
              style={{ width: `${Math.min(100, prediction.prediction_confidence || matchResult?.confidence || 0)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Match Result Probabilities */}
      {matchResult && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 mb-6">
          <h3 className="font-bold text-lg mb-4 text-gray-900 dark:text-white">Mac Sonucu Olasiliklari</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-xl">
              <div className="text-2xl font-bold text-green-600">
                %{typeof matchResult.home_win === 'object' ? matchResult.home_win.probability : matchResult.home_win}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Ev Sahibi</div>
              {typeof matchResult.home_win === 'object' && (
                <div className="text-xs text-gray-500 mt-1">Oran: {matchResult.home_win.odds}</div>
              )}
            </div>
            {matchResult.draw && (
              <div className="text-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                <div className="text-2xl font-bold text-gray-600 dark:text-gray-300">
                  %{typeof matchResult.draw === 'object' ? matchResult.draw.probability : matchResult.draw}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Beraberlik</div>
                {typeof matchResult.draw === 'object' && (
                  <div className="text-xs text-gray-500 mt-1">Oran: {matchResult.draw.odds}</div>
                )}
              </div>
            )}
            <div className="text-center p-4 bg-red-50 dark:bg-red-900/20 rounded-xl">
              <div className="text-2xl font-bold text-red-600">
                %{typeof matchResult.away_win === 'object' ? matchResult.away_win.probability : matchResult.away_win}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Deplasman</div>
              {typeof matchResult.away_win === 'object' && (
                <div className="text-xs text-gray-500 mt-1">Oran: {matchResult.away_win.odds}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* High Confidence Bets */}
      {highBets.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 mb-6">
          <h3 className="font-bold text-lg mb-4 text-green-700 dark:text-green-400">
            Yuksek Guvenli Tahminler
          </h3>
          <div className="space-y-3">
            {highBets.map((bet: any, i: number) => (
              <div key={i} className="border-l-4 border-green-500 bg-green-50 dark:bg-green-900/10 rounded-r-xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-900 dark:text-white">{bet.title}</span>
                  <span className="text-sm font-bold text-green-600">%{bet.confidence}</span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">{bet.description}</p>
                <p className="text-xs text-gray-500 mt-1">{bet.reason}</p>
                <p className="text-xs font-medium text-green-700 dark:text-green-400 mt-1">{bet.recommendation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Medium Risk Bets */}
      {medBets.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 mb-6">
          <h3 className="font-bold text-lg mb-4 text-yellow-700 dark:text-yellow-400">
            Orta Risk Tahminler
          </h3>
          <div className="space-y-3">
            {medBets.map((bet: any, i: number) => (
              <div key={i} className="border-l-4 border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10 rounded-r-xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-900 dark:text-white">{bet.title}</span>
                  <span className="text-sm font-bold text-yellow-600">%{bet.confidence}</span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">{bet.description}</p>
                <p className="text-xs text-gray-500 mt-1">{bet.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* High Risk Bets */}
      {highRiskBets.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 mb-6">
          <h3 className="font-bold text-lg mb-4 text-red-700 dark:text-red-400">
            Yuksek Risk / Yuksek Oranli Tahminler
          </h3>
          <div className="space-y-3">
            {highRiskBets.map((bet: any, i: number) => (
              <div key={i} className="border-l-4 border-red-500 bg-red-50 dark:bg-red-900/10 rounded-r-xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-900 dark:text-white">{bet.title}</span>
                  <span className="text-sm font-bold text-red-600">%{bet.confidence}</span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">{bet.description}</p>
                <p className="text-xs text-gray-500 mt-1">{bet.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Additional Markets */}
      {prediction.total_points && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 mb-6">
          <h3 className="font-bold text-lg mb-4 text-gray-900 dark:text-white">Alt/Ust Tahminleri</h3>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(prediction.total_points || prediction.total_goals || {}).map(([key, value]: [string, any]) => (
              <div key={key} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {key.replace(/_/g, ' ').replace('under', 'Alt').replace('over', 'Ust')}
                </span>
                <span className="font-bold text-sm">
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
