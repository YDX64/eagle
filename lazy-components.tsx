
'use client';

import dynamic from 'next/dynamic';
import { LoadingSpinner } from './loading-spinner';
import { Suspense } from 'react';

// Lazy load heavy components to reduce initial bundle size

export const LazyPredictionModal = dynamic(
  () => import('./prediction-modal').then(mod => ({ default: mod.PredictionModal })),
  {
    loading: () => <LoadingSpinner size="lg" text="Loading prediction..." />,
    ssr: false,
  }
);

export const LazyLeagueStandings = dynamic(
  () => import('./league-standings').then(mod => ({ default: mod.LeagueStandings })),
  {
    loading: () => <LoadingSpinner size="lg" text="Loading standings..." />,
    ssr: false,
  }
);

// Lazy load chart components
export const LazyAdvancedPredictionCard = dynamic(
  () => import('./advanced-prediction-card').then(mod => ({ default: mod.AdvancedPredictionCard })),
  {
    loading: () => <LoadingSpinner size="lg" text="Loading advanced predictions..." />,
    ssr: false,
  }
);

export const LazyApiPredictionsCard = dynamic(
  () => import('./api-predictions-card').then(mod => ({ default: mod.ApiPredictionsCard })),
  {
    loading: () => <LoadingSpinner size="lg" text="Loading API predictions..." />,
    ssr: false,
  }
);

// Wrapper for Plotly charts (heavy dependency)
export const LazyPlotlyChart = dynamic(
  () => import('react-plotly.js'),
  {
    loading: () => <LoadingSpinner size="lg" text="Loading chart..." />,
    ssr: false,
  }
);

// Wrapper component to handle Suspense boundaries
export function LazyComponentWrapper({ 
  children,
  fallback,
}: { 
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return (
    <Suspense fallback={fallback || <LoadingSpinner size="lg" />}>
      {children}
    </Suspense>
  );
}
