import { createPredictionHandler } from '@/lib/sports/base/route-factory';
import { baseballApi } from '@/lib/sports/baseball/api-baseball';
import { BaseballPredictionEngine } from '@/lib/sports/baseball/prediction-engine';

export const dynamic = "force-dynamic";

const handler = createPredictionHandler(
  baseballApi,
  BaseballPredictionEngine,
  'baseball',
);

export const GET = handler;
