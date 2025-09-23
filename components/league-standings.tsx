
'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, ArrowUp, ArrowDown, Minus, Users } from 'lucide-react';
import { Standing } from '@/lib/api-football';

interface LeagueStandingsProps {
  leagueId: number;
  leagueName: string;
  season?: number;
}

export function LeagueStandings({ leagueId, leagueName, season = 2024 }: LeagueStandingsProps) {
  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<{[key: number]: boolean}>({});

  useEffect(() => {
    const fetchStandings = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/leagues/${leagueId}/standings?season=${season}`);
        const data = await response.json();
        
        if (data.success) {
          setStandings(data.data);
        } else {
          setError(data.error);
        }
      } catch (err) {
        setError('Failed to fetch standings');
      } finally {
        setLoading(false);
      }
    };

    fetchStandings();
  }, [leagueId, season]);

  const handleImageError = (teamId: number) => {
    setImageErrors(prev => ({ ...prev, [teamId]: true }));
  };

  const getPositionIcon = (rank: number) => {
    if (rank === 1) return <Trophy className="w-4 h-4 text-yellow-600" />;
    if (rank <= 4) return <ArrowUp className="w-4 h-4 text-green-600" />;
    if (rank >= standings.length - 2) return <ArrowDown className="w-4 h-4 text-red-600" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  const getPositionColor = (rank: number) => {
    if (rank === 1) return 'bg-yellow-50 border-yellow-200';
    if (rank <= 4) return 'bg-green-50 border-green-200';
    if (rank >= standings.length - 2) return 'bg-red-50 border-red-200';
    return 'bg-white';
  };

  const getFormBadge = (form: string) => {
    if (!form) return null;
    
    const wins = (form.match(/W/g) || []).length;
    const total = form.length;
    const winRate = wins / total;
    
    if (winRate >= 0.6) return <Badge className="bg-green-100 text-green-800 text-xs">Good</Badge>;
    if (winRate >= 0.4) return <Badge className="bg-yellow-100 text-yellow-800 text-xs">Average</Badge>;
    return <Badge className="bg-red-100 text-red-800 text-xs">Poor</Badge>;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5" />
            {leagueName} Standings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="animate-pulse flex items-center space-x-4">
                <div className="rounded-full bg-gray-300 h-10 w-10"></div>
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-4 bg-gray-300 rounded w-3/4"></div>
                  <div className="space-y-2">
                    <div className="h-3 bg-gray-300 rounded w-1/2"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5" />
            {leagueName} Standings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            {error}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="w-5 h-5" />
          {leagueName} Standings {season}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="space-y-0">
          {standings.map((standing, index) => (
            <div
              key={standing.team.id}
              className={`flex items-center p-4 border-b last:border-b-0 hover:bg-gray-50 transition-colors ${getPositionColor(standing.rank)}`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex items-center gap-2 w-8">
                  <span className="font-bold text-sm">{standing.rank}</span>
                  {getPositionIcon(standing.rank)}
                </div>
                
                <div className="relative w-8 h-8 flex-shrink-0">
                  {!imageErrors[standing.team.id] ? (
                    <Image
                      src={standing.team.logo || '/placeholder-team.png'}
                      alt={standing.team.name}
                      fill
                      className="object-contain"
                      onError={() => handleImageError(standing.team.id)}
                    />
                  ) : (
                    <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                      <Users className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{standing.team.name}</div>
                  {standing.form && (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="text-xs text-muted-foreground">
                        {standing.form.split('').map((result, i) => (
                          <span
                            key={i}
                            className={`inline-block w-4 h-4 rounded-full text-center text-xs leading-4 mr-1 ${
                              result === 'W' ? 'bg-green-500 text-white' :
                              result === 'D' ? 'bg-yellow-500 text-white' :
                              'bg-red-500 text-white'
                            }`}
                          >
                            {result}
                          </span>
                        ))}
                      </div>
                      {getFormBadge(standing.form)}
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-6 text-sm">
                <div className="text-center hidden sm:block">
                  <div className="font-medium">{standing.all.played}</div>
                  <div className="text-xs text-muted-foreground">MP</div>
                </div>
                <div className="text-center hidden md:block">
                  <div className="font-medium">{standing.all.win}</div>
                  <div className="text-xs text-muted-foreground">W</div>
                </div>
                <div className="text-center hidden md:block">
                  <div className="font-medium">{standing.all.draw}</div>
                  <div className="text-xs text-muted-foreground">D</div>
                </div>
                <div className="text-center hidden md:block">
                  <div className="font-medium">{standing.all.lose}</div>
                  <div className="text-xs text-muted-foreground">L</div>
                </div>
                <div className="text-center">
                  <div className="font-medium">{standing.all.goals.for}:{standing.all.goals.against}</div>
                  <div className="text-xs text-muted-foreground">GD: {standing.goalsDiff >= 0 ? '+' : ''}{standing.goalsDiff}</div>
                </div>
                <div className="text-center min-w-[2rem]">
                  <div className="font-bold text-lg">{standing.points}</div>
                  <div className="text-xs text-muted-foreground">PTS</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
