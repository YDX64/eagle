'use client';

import { useState, useMemo, useCallback } from 'react';
import { Drawer } from 'vaul';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { PredictionCard } from './prediction-card';
import { ApiPredictionsCard } from './api-predictions-card';
import { PredictionDetailedView } from './prediction-detailed-view';
import { MatchCard } from './match-card';
import { MatchPrediction } from '@/lib/prediction-engine';
import { AdvancedMatchPrediction } from '@/lib/advanced-prediction-engine';
import { Fixture } from '@/lib/api-football';
import { TrendingUp, Loader2, X } from 'lucide-react';

interface PredictionModalProps {
  match: Fixture;
  children?: React.ReactNode;
}

/**
 * Responsive prediction drawer:
 *   - Mobile (< md): full-screen bottom sheet, swipe-to-close, safe-area aware
 *   - Desktop (>= md): centered card near top
 *
 * Never uses HTML form or default button type, so no accidental page reload.
 * Uses vaul which handles focus trap, ESC, and back-gesture natively.
 */
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
        case 'W': return 'win';
        case 'L': return 'loss';
        case 'D': return 'draw';
        default: return 'neutral';
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

  const fetchPrediction = useCallback(async () => {
    if (prediction || loading) return;
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
  }, [match.fixture.id, prediction, loading]);

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (open) fetchPrediction();
  }, [fetchPrediction]);

  const activate = useCallback((e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(true);
    fetchPrediction();
  }, [fetchPrediction]);

  const onTriggerKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') activate(e);
  }, [activate]);

  return (
    <>
      {children ? (
        <div
          role="button"
          tabIndex={0}
          onClick={activate}
          onKeyDown={onTriggerKey}
          style={{ display: 'contents' }}
        >
          {children}
        </div>
      ) : (
        <button
          type="button"
          onClick={activate}
          className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium min-h-10 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 touch-manipulation"
        >
          <TrendingUp className="w-4 h-4 mr-2" />
          Tahmin Görüntüle
        </button>
      )}

      <Drawer.Root
        open={isOpen}
        onOpenChange={handleOpenChange}
        shouldScaleBackground={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-50 backdrop-blur-sm" />

          <Drawer.Content
            aria-describedby={undefined}
            className="
              fixed z-50 outline-none flex flex-col bg-background text-foreground
              left-0 right-0 bottom-0 rounded-t-2xl max-h-[96vh] min-h-[60vh]
              md:left-1/2 md:right-auto md:-translate-x-1/2 md:top-[4vh] md:bottom-auto
              md:rounded-2xl md:w-[min(92vw,900px)] md:max-h-[92vh]
              pb-[env(safe-area-inset-bottom)]
              shadow-2xl
            "
            style={{ touchAction: 'pan-y' }}
          >
            {/* Drag handle — mobile only */}
            <div aria-hidden className="mx-auto mt-2.5 mb-1 h-1.5 w-12 flex-shrink-0 rounded-full bg-slate-300 dark:bg-slate-600 md:hidden" />

            {/* Sticky header */}
            <div className="flex items-center justify-between gap-3 px-4 pt-2 pb-3 border-b border-border md:px-6 md:pt-4">
              <div className="min-w-0 flex-1">
                <Drawer.Title className="text-base md:text-xl font-bold leading-tight truncate">
                  Maç Analizi & Tahmin
                </Drawer.Title>
                <div className="text-xs text-muted-foreground truncate mt-0.5">
                  {matchMeta.homeTeam.name} vs {matchMeta.awayTeam.name} · {matchMeta.date} {matchMeta.time}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex-shrink-0 inline-flex items-center justify-center rounded-full w-10 h-10 min-w-10 min-h-10 text-muted-foreground hover:bg-muted transition-colors touch-manipulation"
                aria-label="Kapat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto overscroll-contain flex-1 px-3 py-3 sm:px-4 sm:py-4 md:px-6 md:py-5">
              <div className="space-y-4 sm:space-y-5">
                <div className="bg-muted/50 p-3 sm:p-4 rounded-lg">
                  <MatchCard match={match} showPrediction={false} />
                </div>

                {loading && (
                  <div className="flex items-center justify-center py-10 text-sm sm:text-base">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    <span>Maç verisi analiz ediliyor…</span>
                  </div>
                )}

                {error && (
                  <div className="text-center py-10">
                    <div className="text-red-600 dark:text-red-400 mb-2 font-semibold text-sm sm:text-base">
                      Tahmin oluşturulamadı
                    </div>
                    <div className="text-xs sm:text-sm text-muted-foreground mb-4 px-2">{error}</div>
                    <Button
                      type="button"
                      onClick={() => {
                        setPrediction(null);
                        setAdvancedPrediction(null);
                        setApiPredictions(null);
                        fetchPrediction();
                      }}
                      className="min-h-11 touch-manipulation"
                    >
                      Tekrar Dene
                    </Button>
                  </div>
                )}

                {(advancedPrediction || apiPredictions || prediction) && !loading && (
                  <Tabs defaultValue="advanced" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 h-11 sm:h-10">
                      <TabsTrigger value="advanced" className="text-xs sm:text-sm touch-manipulation">
                        Gelişmiş Analiz
                      </TabsTrigger>
                      <TabsTrigger value="api" className="text-xs sm:text-sm touch-manipulation">
                        AwaStats Resmi
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="advanced" className="space-y-4 mt-4">
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
                        <div className="text-center py-8 text-muted-foreground text-sm">
                          Gelişmiş analiz bulunamadı
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="api" className="space-y-4 mt-4">
                      <ApiPredictionsCard
                        apiPredictions={apiPredictions}
                        homeTeamName={match.teams.home.name}
                        awayTeamName={match.teams.away.name}
                      />
                    </TabsContent>
                  </Tabs>
                )}
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
