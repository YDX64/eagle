import Link from 'next/link';
import { SportSelector } from '@/components/sports/shared/sport-selector';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 transition-colors duration-300">
      <SportSelector />
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-10">
        <section className="text-center space-y-4">
          <h1 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-slate-100">
            Çok Sporlu Tahmin & Takip Paneli
          </h1>
          <p className="text-lg text-slate-600 dark:text-slate-400 max-w-3xl mx-auto">
            Futbol, basketbol, buz hokeyi, hentbol, voleybol ve beyzbol için tüm tahminler,
            marketler ve ROI analizleri.
          </p>
        </section>
        <div className="grid md:grid-cols-3 gap-6">
          <Link
            href="/tracking"
            className="group rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 hover:border-emerald-500 transition-colors shadow-sm"
          >
            <h3 className="text-xl font-semibold text-emerald-600 dark:text-emerald-400 mb-2">
              Takip Paneli →
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Hangi spor + hangi market en çok kazandırıyor? Günlük ROI, win rate, lider tablosu.
            </p>
          </Link>
          <Link
            href="/tracking/value-bets"
            className="group rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 hover:border-amber-500 transition-colors shadow-sm"
          >
            <h3 className="text-xl font-semibold text-amber-600 dark:text-amber-400 mb-2">
              Değer Bahisler →
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Pozitif expected value'ya sahip bekleyen tahminler.
            </p>
          </Link>
          <Link
            href="/tracking/player-props"
            className="group rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 hover:border-purple-500 transition-colors shadow-sm"
          >
            <h3 className="text-xl font-semibold text-purple-600 dark:text-purple-400 mb-2">
              Oyuncu Bahisleri →
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              NBA sayı, NHL atış, MLB strikeout gibi oyuncu bazlı tahminler.
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}
