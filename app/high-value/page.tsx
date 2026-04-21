
import { SportSelector } from '@/components/sports/shared/sport-selector';
import { HighValueDashboard } from './high-value-dashboard';

export default function HighValuePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 dark:from-slate-800 dark:via-yellow-900/10 dark:to-slate-800 transition-colors duration-300">
      <SportSelector />
      <HighValueDashboard />
    </main>
  );
}
