
import { createGamesTodayHandler } from '@/lib/sports/base/route-factory';
import { basketballApi, MAJOR_BASKETBALL_LEAGUES } from '@/lib/sports/basketball/api-basketball';

export const dynamic = "force-dynamic";

const handler = createGamesTodayHandler(
  basketballApi,
  'basketball',
  Object.values(MAJOR_BASKETBALL_LEAGUES)
);

export const GET = handler;
