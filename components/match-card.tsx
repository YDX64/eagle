
'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, MapPin, Users, TrendingUp, Calendar, Target, Trophy } from 'lucide-react';
import { Fixture } from '@/lib/api-football';

interface MatchCardProps {
  match: Fixture;
  onViewPrediction?: (matchId: number) => void;
  showPrediction?: boolean;
}

export function MatchCard({ match, onViewPrediction, showPrediction = true }: MatchCardProps) {
  const [imageError, setImageError] = useState<{[key: string]: boolean}>({});
  const [quickPrediction, setQuickPrediction] = useState<any>(null);
  
  const isLive = match.fixture.status.short === '1H' || match.fixture.status.short === '2H' || match.fixture.status.short === 'HT';
  const isFinished = match.fixture.status.short === 'FT';
  const isUpcoming = match.fixture.status.short === 'NS';
  
  // Fetch quick prediction for badges - disabled for now to avoid too many API calls
  // useEffect(() => {
  //   if (isUpcoming && showPrediction) {
  //     fetch(`/api/predictions/${match.fixture.id}`)
  //       .then(res => res.json())
  //       .then(data => {
  //         if (data.success && data.data.advancedPrediction) {
  //           setQuickPrediction(data.data.advancedPrediction);
  //         }
  //       })
  //       .catch(() => {}); // Silent fail
  //   }
  // }, [match.fixture.id, isUpcoming, showPrediction]);

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

  const getPredictionBadges = () => {
    // Show prediction availability indicator for upcoming matches
    if (!isUpcoming || !showPrediction) return null;
    
    return (
      <div className="flex flex-wrap gap-1 mt-2">
        <Badge className="text-xs bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors">
          <Target className="w-3 h-3 mr-1" />
          Tahmin Mevcut
        </Badge>
      </div>
    );
  };

  const handleImageError = (teamType: 'home' | 'away') => {
    setImageError(prev => ({ ...prev, [teamType]: true }));
  };

  return (
    <Card className="h-full hover:shadow-lg hover:shadow-emerald-100/50 dark:hover:shadow-emerald-500/10 transition-all duration-300 group bg-gradient-to-br from-card via-card to-emerald-50/30 dark:to-emerald-600/10 border-border/50 hover:border-primary/30">
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

        {/* Spacer to push content to bottom */}
        <div className="flex-grow">
          {/* Prediction Badges */}
          {getPredictionBadges()}
        </div>

        {/* Bottom Section - Always at bottom */}
        <div className="mt-auto">
          {/* Action Button */}
          {showPrediction && isUpcoming && onViewPrediction && (
            <Button
              onClick={() => onViewPrediction(match.fixture.id)}
              className="w-full mb-2 h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm hover:shadow-md transition-all duration-200"
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
