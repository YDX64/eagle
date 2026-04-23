'use client';

/**
 * Engine Toggle Wrapper
 *
 * Lets the user switch between Tier 1 (existing basketball engine) and
 * Tier 2 (basketball-v2 with Bayesian + ML ensemble). Lazy-loads v2
 * component so the initial page bundle stays small.
 */

import { useState } from 'react';
import { PredictionDetail } from '@/components/sports/shared/prediction-detail';
import { V2PredictionDetail } from './v2-prediction-detail';
import { SportType } from '@/lib/sports/base/types';

interface EngineToggleWrapperProps {
  sport: SportType;
  source: 'nba' | 'basketball';
  gameId: string;
  tier1ApiPath: string;
  accentColor: string;
  icon: string;
}

export function EngineToggleWrapper({
  sport,
  source,
  gameId,
  tier1ApiPath,
  accentColor,
  icon,
}: EngineToggleWrapperProps) {
  const [engine, setEngine] = useState<'tier1' | 'tier2'>('tier1');

  return (
    <div>
      {/* Engine Toggle */}
      <div className="max-w-6xl mx-auto px-4 pt-4">
        <div className="bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 rounded-2xl p-2 flex items-center gap-1 shadow-md border border-gray-200 dark:border-slate-700">
          <button
            onClick={() => setEngine('tier1')}
            className={`flex-1 px-4 py-3 rounded-xl font-medium text-sm transition-all ${
              engine === 'tier1'
                ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-md'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <span className="text-base">{'\uD83C\uDFC0'}</span>
              <div className="text-left">
                <div className="font-bold">Tier 1 - Klasik</div>
                <div className="text-[10px] text-gray-500 font-normal">Form + H2H + Standings</div>
              </div>
            </div>
          </button>
          <button
            onClick={() => setEngine('tier2')}
            className={`flex-1 px-4 py-3 rounded-xl font-medium text-sm transition-all ${
              engine === 'tier2'
                ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <span className="text-base">{'\uD83E\uDDE0'}</span>
              <div className="text-left">
                <div className="font-bold">Tier 2 - v2 Engine</div>
                <div className={`text-[10px] font-normal ${engine === 'tier2' ? 'text-white/80' : 'text-gray-500'}`}>
                  Bayesian + ML + Monte Carlo
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Render based on engine */}
      {engine === 'tier1' && (
        <PredictionDetail
          sport={sport}
          gameId={gameId}
          apiPath={tier1ApiPath}
          accentColor={accentColor}
          icon={icon}
        />
      )}

      {engine === 'tier2' && (
        <V2PredictionDetail
          gameId={gameId}
          source={source}
          icon={icon}
          accentColor={accentColor}
        />
      )}
    </div>
  );
}
