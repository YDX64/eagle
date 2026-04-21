import { createPredictionHandler } from '@/lib/sports/base/route-factory';
import { handballApi } from '@/lib/sports/handball/api-handball';
import { HandballPredictionEngine } from '@/lib/sports/handball/prediction-engine';

export const dynamic = "force-dynamic";
const handler = createPredictionHandler(handballApi, HandballPredictionEngine, 'handball');
export const GET = handler;
