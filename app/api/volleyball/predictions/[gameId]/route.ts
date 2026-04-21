import { createPredictionHandler } from '@/lib/sports/base/route-factory';
import { volleyballApi } from '@/lib/sports/volleyball/api-volleyball';
import { VolleyballPredictionEngine } from '@/lib/sports/volleyball/prediction-engine';

export const dynamic = "force-dynamic";
const handler = createPredictionHandler(volleyballApi, VolleyballPredictionEngine, 'volleyball');
export const GET = handler;
