
import { SportSelector } from '@/components/sports/shared/sport-selector';
import { PredictionDetail } from '@/components/sports/shared/prediction-detail';

export default async function HockeyPredictionPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-cyan-50 to-sky-50 dark:from-slate-800 dark:via-blue-900/10 dark:to-slate-800">
      <SportSelector />
      <PredictionDetail
        sport="hockey"
        gameId={gameId}
        apiPath={`/api/hockey/predictions/${gameId}`}
        accentColor="blue"
        icon={'\uD83C\uDFD2'}
      />
    </main>
  );
}
