
import { SportSelector } from '@/components/sports/shared/sport-selector';
import { HandballDashboard } from './handball-dashboard';

export default function HandballPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-purple-50 via-violet-50 to-fuchsia-50 dark:from-slate-800 dark:via-purple-900/10 dark:to-slate-800 transition-colors duration-300">
      <SportSelector />
      <HandballDashboard />
    </main>
  );
}
