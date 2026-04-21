
import { SportSelector } from '@/components/sports/shared/sport-selector';
import { PredictionDetail } from '@/components/sports/shared/prediction-detail';

export default async function VolleyballPredictionPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return (
    <main className="min-h-screen bg-gradient-to-br from-pink-50 via-rose-50 to-red-50 dark:from-slate-800 dark:via-pink-900/10 dark:to-slate-800">
      <SportSelector />
      <PredictionDetail
        sport="volleyball"
        gameId={gameId}
        apiPath={`/api/volleyball/predictions/${gameId}`}
        accentColor="pink"
        icon={'\uD83C\uDFD0'}
      />
    </main>
  );
}
