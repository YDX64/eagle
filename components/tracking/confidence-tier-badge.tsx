'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { ConfidenceTier } from '@/lib/hooks/tracking/types';

const TIER_LABELS: Record<ConfidenceTier, string> = {
  platinum: 'Platin',
  gold: 'Altın',
  silver: 'Gümüş',
  bronze: 'Bronz',
};

const TIER_CLASSES: Record<ConfidenceTier, string> = {
  platinum:
    'bg-gradient-to-r from-slate-200 to-slate-300 text-slate-900 border-slate-400 dark:from-slate-300 dark:to-slate-100 dark:text-slate-900 dark:border-slate-200',
  gold:
    'bg-gradient-to-r from-amber-200 to-yellow-300 text-amber-900 border-amber-400 dark:from-amber-500/30 dark:to-yellow-500/30 dark:text-amber-200 dark:border-amber-500/50',
  silver:
    'bg-gradient-to-r from-gray-200 to-gray-300 text-gray-800 border-gray-400 dark:from-gray-600/40 dark:to-gray-500/40 dark:text-gray-200 dark:border-gray-500/50',
  bronze:
    'bg-gradient-to-r from-orange-200 to-amber-200 text-orange-900 border-orange-400 dark:from-orange-900/30 dark:to-amber-900/30 dark:text-orange-200 dark:border-orange-700',
};

export interface ConfidenceTierBadgeProps {
  tier?: ConfidenceTier | null;
  className?: string;
}

export function ConfidenceTierBadge({
  tier,
  className,
}: ConfidenceTierBadgeProps) {
  if (!tier) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold shadow-sm',
        TIER_CLASSES[tier],
        className
      )}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}
