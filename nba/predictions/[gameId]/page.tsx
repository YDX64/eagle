import { SportSelector } from '@/components/sports/shared/sport-selector';
import { NbaPredictionDetail } from '@/components/sports/nba-v2/nba-prediction-detail';

export default async function NbaPredictionPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-blue-50 to-purple-50 dark:from-slate-900 dark:via-indigo-950/40 dark:to-slate-900">
      <SportSelector />
      <NbaPredictionDetail gameId={gameId} />
    </main>
  );
}
