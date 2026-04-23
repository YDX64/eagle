import { createPredictionHandler } from '@/lib/sports/base/route-factory';
import { hockeyApi } from '@/lib/sports/hockey/api-hockey';
import { HockeyPredictionEngine } from '@/lib/sports/hockey/prediction-engine';

export const dynamic = "force-dynamic";

const handler = createPredictionHandler(
  hockeyApi,
  HockeyPredictionEngine,
  'hockey'
);

export const GET = handler;
