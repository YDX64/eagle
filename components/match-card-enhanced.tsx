'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, MapPin, Users, TrendingUp, Calendar, Target, Trophy, AlertCircle, Star, Zap } from 'lucide-react';
import { Fixture } from '@/lib/api-football';
import { cn } from '@/lib/utils';

interface MatchCardEnhancedProps {
  match: Fixture;
  onViewPrediction?: (matchId: number) => void;
  showPrediction?: boolean;
  predictionData?: {
    confidence_score: number;
    recommended_bet: string;
    last_updated: string;
  };
}

export function MatchCardEnhanced({
  match,
  onViewPrediction,
  showPrediction = true,
  predictionData
}: MatchCardEnhancedProps) {
  const [imageError, setImageError] = useState<{[key: string]: boolean}>({});

  const isLive = match.fixture.status.short === '1H' || match.fixture.status.short === '2H' || match.fixture.status.short === 'HT';
  const isFinished = match.fixture.status.short === 'FT';
  const isUpcoming = match.fixture.status.short === 'NS';

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('sv-SE', {
      timeZone: 'Europe/Stockholm',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('sv-SE', {
      timeZone: 'Europe/Stockholm',
      day: '2-digit',
      month: '2-digit'
    });
  };

  const getStatusBadge = () => {
    if (isLive) {
      return <Badge className="animate-pulse text-xs bg-red-500 hover:bg-red-600 text-white">
        <div className="w-1.5 h-1.5 bg-white rounded-full mr-1"></div>
        CANLI {match.fixture.status.elapsed}'
      </Badge>;
    }

    if (isFinished) {
      return <Badge className="text-xs bg-green-500 hover:bg-green-600 text-white">MS</Badge>;
    }

    if (isUpcoming) {
      return <Badge variant="outline" className="text-xs border-primary/30 text-primary">
        <Clock className="w-3 h-3 mr-1" />
        {formatTime(match.fixture.date)}
      </Badge>;
    }

    return <Badge variant="outline" className="text-xs">{match.fixture.status.long}</Badge>;
  };

  const getConfidenceBadge = () => {
    if (!predictionData) return null;

    const { confidence_score } = predictionData;

    if (confidence_score >= 85) {
      return (
        <Badge className="text-xs bg-gradient-to-r from-green-500 to-emerald-500 text-white border-0 animate-pulse">
          <Star className="w-3 h-3 mr-1 fill-current" />
          Çok Yüksek Güven %{Math.round(confidence_score)}
        </Badge>
      );
    }

    if (confidence_score >= 75) {
      return (
        <Badge className="text-xs bg-gradient-to-r from-blue-500 to-indigo-500 text-white border-0">
          <Zap className="w-3 h-3 mr-1" />
          Yüksek Güven %{Math.round(confidence_score)}
        </Badge>
      );
    }

    if (confidence_score >= 65) {
      return (
        <Badge className="text-xs bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30">
          <Target className="w-3 h-3 mr-1" />
          Orta Güven %{Math.round(confidence_score)}
        </Badge>
      );
    }

    return (
      <Badge className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-700">
        <AlertCircle className="w-3 h-3 mr-1" />
        Düşük Güven
      </Badge>
    );
  };

  const getRecommendedBetDisplay = () => {
    if (!predictionData || !predictionData.recommended_bet) return null;

    const { recommended_bet, confidence_score } = predictionData;

    // Only show for high confidence predictions
    if (confidence_score < 75) return null;

    return (
      <div className={cn(
        "mt-2 p-2 rounded-lg text-xs font-medium",
        confidence_score >= 85
          ? "bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
          : "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800"
      )}>
        <div className="flex items-center gap-1">
          <Trophy className="w-3 h-3" />
          <span className="font-semibold">Öneri:</span>
          <span>{recommended_bet}</span>
        </div>
      </div>
    );
  };

  const handleImageError = (teamType: 'home' | 'away') => {
    setImageError(prev => ({ ...prev, [teamType]: true }));
  };

  const cardClassName = cn(
    "h-full transition-all duration-300 group",
    "hover:shadow-lg dark:hover:shadow-emerald-500/10",
    "bg-gradient-to-br from-card via-card",
    "border-border/50 hover:border-primary/30",
    predictionData && predictionData.confidence_score >= 85 &&
      "ring-2 ring-emerald-500/20 hover:ring-emerald-500/40",
    predictionData && predictionData.confidence_score >= 75 && predictionData.confidence_score < 85 &&
      "ring-1 ring-blue-500/20 hover:ring-blue-500/30"
  );

  return (
    <Card className={cardClassName}>
      <CardContent className="p-4 h-full flex flex-col">
        {/* Header: League & Status */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="relative w-5 h-5 flex-shrink-0">
              <Image
                src={match.league.logo}
                alt={match.league.name}
                width={20}
                height={20}
                className="rounded object-contain"
                onError={() => handleImageError('league' as any)}
              />
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {match.league.name}
            </div>
          </div>
          {getStatusBadge()}
        </div>

        {/* Confidence Badge - Prominently displayed */}
        {isUpcoming && predictionData && (
          <div className="mb-3">
            {getConfidenceBadge()}
          </div>
        )}

        {/* Teams & Score */}
        <div className="grid grid-cols-3 items-center gap-3 mb-3">
          {/* Home Team */}
          <div className="flex flex-col items-center space-y-2">
            <div className="relative w-8 h-8 flex-shrink-0">
              {!imageError.home ? (
                <Image
                  src={match.teams.home.logo || '/placeholder-team.png'}
                  alt={match.teams.home.name}
                  width={32}
                  height={32}
                  className="object-contain"
                  onError={() => handleImageError('home')}
                />
              ) : (
                <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                  <Users className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="text-xs font-medium text-center leading-tight h-8 flex items-center justify-center">
              <span className="line-clamp-2">
                {match.teams.home.name}
              </span>
            </div>
          </div>

          {/* Score & Time */}
          <div className="text-center">
            {isFinished || isLive ? (
              <div className="text-xl font-bold">
                {match.goals.home} - {match.goals.away}
              </div>
            ) : (
              <div className="text-lg font-medium text-muted-foreground">
                VS
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              {formatDate(match.fixture.date)}
            </div>
          </div>

          {/* Away Team */}
          <div className="flex flex-col items-center space-y-2">
            <div className="relative w-8 h-8 flex-shrink-0">
              {!imageError.away ? (
                <Image
                  src={match.teams.away.logo || '/placeholder-team.png'}
                  alt={match.teams.away.name}
                  width={32}
                  height={32}
                  className="object-contain"
                  onError={() => handleImageError('away')}
                />
              ) : (
                <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                  <Users className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="text-xs font-medium text-center leading-tight h-8 flex items-center justify-center">
              <span className="line-clamp-2">
                {match.teams.away.name}
              </span>
            </div>
          </div>
        </div>

        {/* Recommended Bet Display */}
        {isUpcoming && getRecommendedBetDisplay()}

        {/* Spacer to push content to bottom */}
        <div className="flex-grow" />

        {/* Bottom Section - Always at bottom */}
        <div className="mt-auto">
          {/* Action Button */}
          {showPrediction && isUpcoming && onViewPrediction && (
            <Button
              onClick={() => onViewPrediction(match.fixture.id)}
              className={cn(
                "w-full mb-2 h-8 text-xs shadow-sm hover:shadow-md transition-all duration-200",
                predictionData && predictionData.confidence_score >= 75
                  ? "bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white"
                  : "bg-primary hover:bg-primary/90 text-primary-foreground"
              )}
              size="sm"
            >
              <TrendingUp className="w-3 h-3 mr-1" />
              Detaylı Tahmin
            </Button>
          )}

          {/* Venue Info */}
          {match.fixture.venue && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground pt-2 border-t">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">
                {match.fixture.venue.name}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}