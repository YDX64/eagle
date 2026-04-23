
import { SportSelector } from '@/components/sports/shared/sport-selector';
import { BasketballDashboard } from './basketball-dashboard';

export default function BasketballPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 dark:from-slate-800 dark:via-orange-900/10 dark:to-slate-800 transition-colors duration-300">
      <SportSelector />
      <BasketballDashboard />
    </main>
  );
}
