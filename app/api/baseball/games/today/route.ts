import { createGamesTodayHandler } from '@/lib/sports/base/route-factory';
import { baseballApi, MAJOR_BASEBALL_LEAGUES } from '@/lib/sports/baseball/api-baseball';

export const dynamic = "force-dynamic";

const handler = createGamesTodayHandler(
  baseballApi,
  'baseball',
  Object.values(MAJOR_BASEBALL_LEAGUES),
);

export const GET = handler;
