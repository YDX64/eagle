
import { SportSelector } from '@/components/sports/shared/sport-selector';
import { EngineToggleWrapper } from '@/components/sports/basketball-v2/engine-toggle-wrapper';

export default async function BasketballPredictionPage({
  params,
  searchParams,
}: {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<{ source?: 'nba' | 'basketball' }>;
}) {
  const { gameId } = await params;
  const { source } = await searchParams;
  // Default to basketball source, allow ?source=nba override for NBA player props
  const v2Source: 'nba' | 'basketball' = source === 'nba' ? 'nba' : 'basketball';

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 dark:from-slate-800 dark:via-orange-900/10 dark:to-slate-800">
      <SportSelector />
      <EngineToggleWrapper
        sport="basketball"
        source={v2Source}
        gameId={gameId}
        tier1ApiPath={`/api/basketball/predictions/${gameId}`}
        accentColor="orange"
        icon={'\uD83C\uDFC0'}
      />
    </main>
  );
}
