import { createGamesTodayHandler } from '@/lib/sports/base/route-factory';
import { handballApi, MAJOR_HANDBALL_LEAGUES } from '@/lib/sports/handball/api-handball';

export const dynamic = "force-dynamic";
const handler = createGamesTodayHandler(handballApi, 'handball', Object.values(MAJOR_HANDBALL_LEAGUES));
export const GET = handler;
