import { SportSelector } from '@/components/sports/shared/sport-selector';
import { NbaDashboard } from './nba-dashboard';

export default function NbaPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-blue-50 to-purple-50 dark:from-slate-900 dark:via-indigo-950/40 dark:to-slate-900 transition-colors duration-300">
      <SportSelector />
      <NbaDashboard />
    </main>
  );
}
