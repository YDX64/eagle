import { createGamesTodayHandler } from '@/lib/sports/base/route-factory';
import { hockeyApi, MAJOR_HOCKEY_LEAGUES } from '@/lib/sports/hockey/api-hockey';

export const dynamic = "force-dynamic";

const handler = createGamesTodayHandler(
  hockeyApi,
  'hockey',
  Object.values(MAJOR_HOCKEY_LEAGUES)
);

export const GET = handler;
