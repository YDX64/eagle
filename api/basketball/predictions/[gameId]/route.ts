
import { createPredictionHandler } from '@/lib/sports/base/route-factory';
import { basketballApi } from '@/lib/sports/basketball/api-basketball';
import { BasketballPredictionEngine } from '@/lib/sports/basketball/prediction-engine';

export const dynamic = "force-dynamic";

const handler = createPredictionHandler(
  basketballApi,
  BasketballPredictionEngine,
  'basketball'
);

export const GET = handler;
