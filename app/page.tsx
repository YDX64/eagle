
import { MatchesDashboard } from '@/components/matches-dashboard';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-slate-800 dark:via-slate-700 dark:to-emerald-800 transition-colors duration-300">
      <div className="relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-300/20 via-transparent to-transparent dark:from-emerald-400/10 dark:via-transparent dark:to-transparent"></div>
        <div className="absolute inset-0 bg-grid-slate-100/50 dark:bg-grid-slate-600/20 [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]"></div>
        <div className="relative">
          <MatchesDashboard />
        </div>
      </div>
    </main>
  );
}
