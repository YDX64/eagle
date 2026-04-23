
import { SportSelector } from '@/components/sports/shared/sport-selector';
import { HandballDashboard } from './handball-dashboard';

export default function HandballPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 transition-colors">
      <SportSelector />
      <HandballDashboard />
    </main>
  );
}
