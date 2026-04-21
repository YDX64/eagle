import { createGamesTodayHandler } from '@/lib/sports/base/route-factory';
import { volleyballApi, MAJOR_VOLLEYBALL_LEAGUES } from '@/lib/sports/volleyball/api-volleyball';

export const dynamic = "force-dynamic";
const handler = createGamesTodayHandler(volleyballApi, 'volleyball', Object.values(MAJOR_VOLLEYBALL_LEAGUES));
export const GET = handler;
