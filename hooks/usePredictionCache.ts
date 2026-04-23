import { useState, useEffect } from 'react';

interface PredictionSummary {
  match_id: number;
  confidence_score: number;
  recommended_bet: string;
  last_updated: string;
}

interface UsePredictionCacheOptions {
  matchIds: number[];
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
}

export function usePredictionCache({
  matchIds,
  autoRefresh = false,
  refreshInterval = 300000 // 5 minutes default
}: UsePredictionCacheOptions) {
  const [predictions, setPredictions] = useState<Map<number, PredictionSummary>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPredictions = async () => {
    if (matchIds.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/predictions/batch-analyze-sqlite?matchIds=${matchIds.join(',')}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch predictions');
      }

      const data = await response.json();

      if (data.success && data.predictions) {
        const predictionMap = new Map<number, PredictionSummary>();
        data.predictions.forEach((pred: PredictionSummary) => {
          predictionMap.set(pred.match_id, pred);
        });
        setPredictions(predictionMap);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPredictions();

    if (autoRefresh && refreshInterval > 0) {
      const interval = setInterval(fetchPredictions, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [matchIds.join(','), autoRefresh, refreshInterval]);

  const getPrediction = (matchId: number): PredictionSummary | undefined => {
    return predictions.get(matchId);
  };

  const getHighConfidencePredictions = (threshold: number = 75): PredictionSummary[] => {
    return Array.from(predictions.values()).filter(
      pred => pred.confidence_score >= threshold
    );
  };

  const refreshPrediction = async (matchId: number) => {
    try {
      const response = await fetch('/api/predictions/batch-analyze-sqlite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchIds: [matchId],
          forceUpdate: true
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.predictions?.length > 0) {
          setPredictions(prev => {
            const newMap = new Map(prev);
            newMap.set(matchId, data.predictions[0]);
            return newMap;
          });
        }
      }
    } catch (err) {
      console.error('Failed to refresh prediction:', err);
    }
  };

  return {
    predictions,
    loading,
    error,
    getPrediction,
    getHighConfidencePredictions,
    refreshPrediction,
    refetchAll: fetchPredictions
  };
}