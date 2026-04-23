
'use client';

import { useState, useEffect } from 'react';

interface ValueBetDisplay {
  sport: string;
  game_id: number;
  home_team: string;
  away_team: string;
  league_name: string;
  game_date: string;
  market: string;
  selection: string;
  our_probability: number;
  market_odds: number;
  implied_probability: number;
  value_edge: number;
  expected_value: number;
  kelly_percentage: number;
  confidence_tier: string;
  confidence_score: number;
  reasoning: string;
}

const sportIcons: Record<string, string> = {
  basketball: '\uD83C\uDFC0',
  hockey: '\uD83C\uDFD2',
  handball: '\uD83E\uDD3E',
  volleyball: '\uD83C\uDFD0',
  football: '\u26BD',
};

const sportColors: Record<string, string> = {
  basketball: 'border-orange-400 bg-orange-50 dark:bg-orange-900/20',
  hockey: 'border-blue-400 bg-blue-50 dark:bg-blue-900/20',
  handball: 'border-purple-400 bg-purple-50 dark:bg-purple-900/20',
  volleyball: 'border-pink-400 bg-pink-50 dark:bg-pink-900/20',
  football: 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20',
};

const tierColors: Record<string, string> = {
  platinum: 'bg-gradient-to-r from-gray-200 to-gray-400 text-gray-800',
  gold: 'bg-gradient-to-r from-yellow-300 to-yellow-500 text-yellow-900',
  silver: 'bg-gradient-to-r from-gray-300 to-gray-400 text-gray-700',
};

export function HighValueDashboard() {
  const [bets, setBets] = useState<ValueBetDisplay[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sportFilter, setSportFilter] = useState<string>('all');

  useEffect(() => {
    fetchBets();
  }, []);

  const fetchBets = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '30', minEdge: '3' });
      const res = await fetch(`/api/high-value?${params}`);
      const data = await res.json();
      if (data.success) {
        setBets(data.data?.bets || []);
        setSummary(data.data?.summary || null);
      } else {
        setError(data.error || 'Yuklenemedi');
      }
    } catch {
      setError('Baglanti hatasi');
    } finally {
      setLoading(false);
    }
  };

  const filteredBets = sportFilter === 'all' ? bets : bets.filter((b) => b.sport === sportFilter);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <span className="text-4xl">{'\uD83D\uDCB0'}</span>
        <div>
          <h1 className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">Yuksek Degerli Tahminler</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Tum sporlardaki value bet firsatlari | EV {'>'}  0 | Edge {'>'} 3%
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-yellow-200 dark:border-yellow-800">
            <div className="text-2xl font-bold text-yellow-600">{summary.total_bets}</div>
            <div className="text-xs text-gray-500">Toplam Bahis</div>
          </div>
          {summary.by_tier?.map((t: any) => (
            <div key={t.tier} className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${tierColors[t.tier] || ''}`}>
                  {t.tier?.toUpperCase()}
                </span>
                <span className="text-xl font-bold">{t.count}</span>
              </div>
              <div className="text-xs text-gray-500">Ort. Guven: %{t.avg_confidence}</div>
            </div>
          ))}
        </div>
      )}

      {/* Sport Filter */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto">
        <button
          onClick={() => setSportFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            sportFilter === 'all' ? 'bg-yellow-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
          }`}
        >
          Tumu
        </button>
        {['basketball', 'hockey', 'handball', 'volleyball'].map((s) => (
          <button
            key={s}
            onClick={() => setSportFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              sportFilter === s ? 'bg-yellow-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
            }`}
          >
            {sportIcons[s]} {s === 'basketball' ? 'Basketbol' : s === 'hockey' ? 'Hokey' : s === 'handball' ? 'Hentbol' : 'Voleybol'}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-20">
          <div className="w-12 h-12 border-4 border-gray-200 border-t-yellow-500 rounded-full animate-spin"></div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-red-700 dark:text-red-400 mb-4">
          {error}
        </div>
      )}

      {/* Bets List */}
      {!loading && !error && (
        <div className="space-y-3">
          {filteredBets.length === 0 ? (
            <div className="text-center py-20 text-gray-500">
              <span className="text-6xl block mb-4">{'\uD83D\uDCB0'}</span>
              <p>Yuksek degerli bahis bulunamadi</p>
              <p className="text-sm mt-2">Maclar basladiginda burada value bet firsatlari gorunecek</p>
            </div>
          ) : (
            filteredBets.map((bet, idx) => (
              <div
                key={`${bet.game_id}-${bet.market}-${idx}`}
                className={`rounded-xl border-l-4 p-4 bg-white dark:bg-slate-800/80 shadow-sm hover:shadow-md transition-all ${sportColors[bet.sport] || ''}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{sportIcons[bet.sport]}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${tierColors[bet.confidence_tier] || ''}`}>
                        {bet.confidence_tier?.toUpperCase()}
                      </span>
                      <span className="text-xs text-gray-500">{bet.league_name}</span>
                    </div>
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {bet.home_team} vs {bet.away_team}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-green-600">+{bet.expected_value}%</div>
                    <div className="text-[10px] text-gray-500">Beklenen Deger</div>
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3 mb-2">
                  <div className="font-medium text-sm text-gray-900 dark:text-white mb-1">{bet.market}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-300">{bet.selection}</div>
                </div>

                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <div>
                    <div className="font-bold text-gray-900 dark:text-white">%{bet.our_probability}</div>
                    <div className="text-gray-500">Olasilik</div>
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 dark:text-white">{bet.market_odds}</div>
                    <div className="text-gray-500">Oran</div>
                  </div>
                  <div>
                    <div className="font-bold text-green-600">+{bet.value_edge}%</div>
                    <div className="text-gray-500">Edge</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-600">{bet.kelly_percentage}%</div>
                    <div className="text-gray-500">Kelly</div>
                  </div>
                </div>

                {bet.reasoning && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">{bet.reasoning}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
