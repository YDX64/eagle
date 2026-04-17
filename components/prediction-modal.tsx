
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { PredictionCard } from './prediction-card';
import { ApiPredictionsCard } from './api-predictions-card';
import { PredictionDetailedView } from './prediction-detailed-view';
import { MatchCard } from './match-card';
import { MatchPrediction } from '@/lib/prediction-engine';
import { AdvancedMatchPrediction } from '@/lib/advanced-prediction-engine';
import { Fixture } from '@/lib/api-football';
import { TrendingUp, Loader2 } from 'lucide-react';

interface PredictionModalProps {
  match: Fixture;
  children?: React.ReactNode;
}

export function PredictionModal({ match, children }: PredictionModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [prediction, setPrediction] = useState<MatchPrediction | null>(null);
  const [advancedPrediction, setAdvancedPrediction] = useState<AdvancedMatchPrediction | null>(null);
  const [apiPredictions, setApiPredictions] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseApiForm = (value?: string | null) => {
    if (!value) return undefined;
    const normalized = value.replace(/[^WLD]/gi, '').toUpperCase();
    if (!normalized) return undefined;
    return Array.from(normalized).map((char) => {
      switch (char) {
        case 'W':
          return 'win';
        case 'L':
          return 'loss';
        case 'D':
          return 'draw';
        default:
          return 'neutral';
      }
    });
  };

  const matchMeta = useMemo(() => {
    const fixtureDate = new Date(match.fixture.date);
    return {
      league: match.league?.name ?? 'Unknown League',
      date: fixtureDate.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      time: fixtureDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      homeTeam: {
        name: match.teams.home.name,
        logo: match.teams.home.logo ?? undefined,
        form: parseApiForm(apiPredictions?.comparison?.form?.home ?? null),
      },
      awayTeam: {
        name: match.teams.away.name,
        logo: match.teams.away.logo ?? undefined,
        form: parseApiForm(apiPredictions?.comparison?.form?.away ?? null),
      },
    };
  }, [match, apiPredictions]);

  const fetchPrediction = async () => {
    if (prediction || loading) return; // Don't fetch if already loaded or loading
    
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`/api/predictions/${match.fixture.id}`);
      const data = await response.json();
      
      if (data.success) {
        setPrediction(data.data.prediction);
        setAdvancedPrediction(data.data.advancedPrediction);
        setApiPredictions(data.data.apiPredictions);
      } else {
        setError(data.message || 'Failed to generate prediction');
      }
    } catch (err) {
      setError('Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      fetchPrediction();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children || (
          <Button className="w-full">
            <TrendingUp className="w-4 h-4 mr-2" />
            View Prediction
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">
            Match Analysis & Prediction
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Match Info */}
          <div className="bg-muted/50 p-4 rounded-lg">
            <MatchCard match={match} showPrediction={false} />
          </div>
          
          {/* Prediction Content */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              <span>Analyzing match data and generating prediction...</span>
            </div>
          )}
          
          {error && (
            <div className="text-center py-12">
              <div className="text-red-600 mb-2">Failed to generate prediction</div>
              <div className="text-sm text-muted-foreground mb-4">{error}</div>
              <Button onClick={() => {
                setPrediction(null);
                setAdvancedPrediction(null);
                setApiPredictions(null);
                fetchPrediction();
              }}>
                Retry
              </Button>
            </div>
          )}
          
          {(advancedPrediction || apiPredictions || prediction) && !loading && (
            <Tabs defaultValue="advanced" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="advanced">Gelişmiş Analiz</TabsTrigger>
                <TabsTrigger value="api">AwaStats Resmi</TabsTrigger>
              </TabsList>

              <TabsContent value="advanced" className="space-y-4">
                {advancedPrediction ? (
                  <PredictionDetailedView
                    match={matchMeta}
                    advancedPrediction={advancedPrediction}
                    apiPrediction={apiPredictions}
                  />
                ) : prediction ? (
                  <PredictionCard
                    prediction={prediction}
                    homeTeamName={match.teams.home.name}
                    awayTeamName={match.teams.away.name}
                  />
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    Gelişmiş analiz bulunamadı
                  </div>
                )}
              </TabsContent>

              <TabsContent value="api" className="space-y-4">
                <ApiPredictionsCard
                  apiPredictions={apiPredictions}
                  homeTeamName={match.teams.home.name}
                  awayTeamName={match.teams.away.name}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
