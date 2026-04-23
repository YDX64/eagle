'use client';
import nextDynamic from 'next/dynamic';
import { SportSelector } from '@/components/sports/shared/sport-selector';

const AllSportsApp = nextDynamic(() => import('@/components/all-sports/AllSportsApp'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mx-auto mb-3"></div>
        <p>Tüm Sporlar Analiz Platformu yükleniyor...</p>
      </div>
    </div>
  ),
});

export default function AllSportsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 transition-colors">
      <SportSelector />
      <div className="all-sports-embedded">
        <AllSportsApp />
      </div>
    </main>
  );
}
