import { SportSelector } from '@/components/sports/shared/sport-selector';
import { NbaPredictionDetail } from '@/components/sports/nba-v2/nba-prediction-detail';

export default async function NbaPredictionPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 transition-colors">
      <SportSelector />
      <NbaPredictionDetail gameId={gameId} />
    </main>
  );
}
