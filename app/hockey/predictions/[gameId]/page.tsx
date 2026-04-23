
import { SportSelector } from '@/components/sports/shared/sport-selector';
import { PredictionDetail } from '@/components/sports/shared/prediction-detail';

export default async function HockeyPredictionPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 transition-colors">
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
