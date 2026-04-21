
import { SportSelector } from '@/components/sports/shared/sport-selector';
import { VolleyballDashboard } from './volleyball-dashboard';

export default function VolleyballPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-pink-50 via-rose-50 to-red-50 dark:from-slate-800 dark:via-pink-900/10 dark:to-slate-800 transition-colors duration-300">
      <SportSelector />
      <VolleyballDashboard />
    </main>
  );
}
