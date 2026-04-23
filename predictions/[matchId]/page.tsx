'use client';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Typography,
} from '@mui/material';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { use, useEffect, useMemo, useState } from 'react';

import BettingPrediction from '@/components/mui-analysis/betting-prediction';
import MuiAnalysisThemeProvider from '@/components/mui-analysis/mui-theme-provider';
import {
  transformApiResponseToMuiData,
  type BettingPredictionData,
  type PredictionApiResponse,
} from '@/lib/mui-data-mapper';
import type { PredictionApiData } from '@/lib/types';

type PredictionEnvelope = {
  success: boolean;
  data: PredictionApiData;
  error?: string;
  message?: string;
};

type PredictionsPageProps = {
  params: Promise<{
    matchId: string;
  }>;
};

export default function PredictionsPage({ params }: PredictionsPageProps) {
  const { matchId } = use(params);
  const router = useRouter();
  const [data, setData] = useState<PredictionApiData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    setIsLoading(true);
    setError(null);

    const load = async () => {
      try {
        const response = await fetch(`/api/predictions/${matchId}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('Unable to retrieve prediction data.');
        }

        const payload = (await response.json()) as PredictionEnvelope;

        if (!payload.success) {
          throw new Error(
            payload.error ||
              payload.message ||
              'Unable to retrieve prediction data.',
          );
        }

        if (!active) {
          return;
        }

        setData(payload.data);
      } catch (fetchError) {
        if (!active || (fetchError as Error).name === 'AbortError') {
          return;
        }

        setError(
          (fetchError as Error).message ||
            'An unexpected error prevented loading predictions.',
        );
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, [matchId]);

  const mappedData = useMemo<BettingPredictionData | null>(() => {
    if (!data) {
      return null;
    }

    try {
      return transformApiResponseToMuiData(data);
    } catch (mappingError) {
      console.error('[PredictionsPage] Failed to map prediction data', mappingError);
      return null;
    }
  }, [data]);

  return (
    <MuiAnalysisThemeProvider>
      <Box
        sx={{
          minHeight: '100vh',
          backgroundColor: 'background.default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingY: { xs: 6, md: 8 },
          paddingX: { xs: 2, md: 4 },
          width: '100%',
        }}
      >
        {isLoading && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <CircularProgress color="primary" />
            <Typography variant="body2" color="text.secondary">
              Loading prediction data…
            </Typography>
          </Box>
        )}

        {!isLoading && error && (
          <Alert
            severity="error"
            variant="outlined"
            sx={{ maxWidth: 520, width: '100%' }}
          >
            {error}
          </Alert>
        )}

        {!isLoading && !error && mappedData && (
          <Box sx={{ width: '100%' }}>
            <Box
              sx={{
                position: 'fixed',
                top: { xs: 16, md: 24 },
                left: { xs: 16, md: 32 },
                zIndex: (theme) => theme.zIndex.appBar + 1,
              }}
            >
              <Button
                variant="contained"
                color="primary"
                startIcon={<ChevronLeft size={18} />}
                onClick={() => router.push('/')}
                sx={{
                  borderRadius: 999,
                  boxShadow: '0 10px 30px rgba(15, 118, 110, 0.35)',
                }}
              >
                Back to Dashboard
              </Button>
            </Box>

            <BettingPrediction
              matchData={mappedData.matchData}
              predictions={mappedData.predictions}
            />
          </Box>
        )}

        {!isLoading && !error && !mappedData && (
          <Alert
            severity="warning"
            variant="outlined"
            sx={{ maxWidth: 520, width: '100%' }}
          >
            Prediction data is available but could not be displayed.
          </Alert>
        )}
      </Box>
    </MuiAnalysisThemeProvider>
  );
}

