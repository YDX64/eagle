"use client";
import nextDynamic from 'next/dynamic';
import { SportSelector } from '@/components/sports/shared/sport-selector';
import { LocaleProvider } from '@/components/hockey-2/contexts/LocaleContext';

const Home = nextDynamic(() => import('@/components/hockey-2/pages/Home'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-20 text-muted-foreground">Yükleniyor...</div>
  ),
});

export default function Hockey2HomePage() {
  return (
    <LocaleProvider>
      <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 transition-colors">
        <SportSelector />
        <div className="container mx-auto px-4 py-6">
          <Home />
        </div>
      </main>
    </LocaleProvider>
  );
}
