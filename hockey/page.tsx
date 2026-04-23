
import { SportSelector } from '@/components/sports/shared/sport-selector';
import { HockeyDashboard } from './hockey-dashboard';

export default function HockeyPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-cyan-50 to-sky-50 dark:from-slate-800 dark:via-blue-900/10 dark:to-slate-800 transition-colors duration-300">
      <SportSelector />
      <HockeyDashboard />
    </main>
  );
}
