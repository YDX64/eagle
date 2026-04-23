import { SportSelector } from '@/components/sports/shared/sport-selector';
import { NbaDashboard } from './nba-dashboard';

export default function NbaPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 transition-colors">
      <SportSelector />
      <NbaDashboard />
    </main>
  );
}
