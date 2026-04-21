
import { SportSelector } from '@/components/sports/shared/sport-selector';
import { PredictionDetail } from '@/components/sports/shared/prediction-detail';

export default async function HandballPredictionPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return (
    <main className="min-h-screen bg-gradient-to-br from-purple-50 via-violet-50 to-fuchsia-50 dark:from-slate-800 dark:via-purple-900/10 dark:to-slate-800">
      <SportSelector />
      <PredictionDetail
        sport="handball"
        gameId={gameId}
        apiPath={`/api/handball/predictions/${gameId}`}
        accentColor="purple"
        icon={'\uD83E\uDD3E'}
      />
    </main>
  );
}
