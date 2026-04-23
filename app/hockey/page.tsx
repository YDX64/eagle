
import { SportSelector } from '@/components/sports/shared/sport-selector';
import { HockeyDashboard } from './hockey-dashboard';

export default function HockeyPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 transition-colors">
      <SportSelector />
      <HockeyDashboard />
    </main>
  );
}
