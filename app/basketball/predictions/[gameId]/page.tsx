
import { SportSelector } from '@/components/sports/shared/sport-selector';
import { PredictionDetail } from '@/components/sports/shared/prediction-detail';

export default async function BasketballPredictionPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 dark:from-slate-800 dark:via-orange-900/10 dark:to-slate-800">
      <SportSelector />
      <PredictionDetail
        sport="basketball"
        gameId={gameId}
        apiPath={`/api/basketball/predictions/${gameId}`}
        accentColor="orange"
        icon={'\uD83C\uDFC0'}
      />
    </main>
  );
}
