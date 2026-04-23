
'use client';

import { memo } from 'react';
import { ThemeToggle } from './theme-toggle';
import { Badge } from '@/components/ui/badge';
import { formatToStockholmDateTime } from '@/lib/utils';
import { Clock, Trophy, TrendingUp } from 'lucide-react';

interface ProductionHeaderProps {
  stats?: {
    totalMatches?: number;
    liveMatches?: number;
    upcomingMatches?: number;
    finishedMatches?: number;
  };
  currentTime?: string;
}

export const ProductionHeader = memo<ProductionHeaderProps>(({ stats, currentTime }) => {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 max-w-6xl items-center justify-between px-4">
        {/* Left side - Logo and title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg flex items-center justify-center">
              <Trophy className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">
                Football Predictions
              </h1>
              <p className="text-xs text-muted-foreground leading-none">
                AI-Powered Analysis
              </p>
            </div>
          </div>
        </div>

        {/* Center - Stats (on larger screens) */}
        <div className="hidden md:flex items-center gap-4">
          {stats && (
            <>
              <Badge variant="secondary" className="font-mono">
                <TrendingUp className="w-3 h-3 mr-1" />
                {stats.totalMatches || 0} Total
              </Badge>
              {(stats.liveMatches ?? 0) > 0 && (
                <Badge variant="destructive" className="font-mono animate-pulse">
                  🔴 {stats.liveMatches} Live
                </Badge>
              )}
              <Badge variant="outline" className="font-mono">
                {stats.upcomingMatches || 0} Upcoming
              </Badge>
            </>
          )}
        </div>

        {/* Right side - Time and theme toggle */}
        <div className="flex items-center gap-3">
          {currentTime && (
            <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span className="font-mono">
                Stockholm: {formatToStockholmDateTime(currentTime)}
              </span>
            </div>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
});

ProductionHeader.displayName = 'ProductionHeader';
