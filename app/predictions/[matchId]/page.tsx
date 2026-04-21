'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import VelocityGlassPrediction from '@/components/velocity-glass-prediction';
import type { EnhancedPredictionResult } from '@/lib/enhanced-prediction-engine';

type PredictionsPageProps = {
  params: Promise<{ matchId: string }>;
};

export default function PredictionsPage({ params }: PredictionsPageProps) {
  const { matchId } = use(params);
  const router = useRouter();
  const [data, setData] = useState<EnhancedPredictionResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    setIsLoading(true);
    setError(null);

    const load = async () => {
      try {
        // Try enhanced endpoint first
        let response = await fetch(`/api/predictions/${matchId}/enhanced`, {
          signal: controller.signal,
        });

        // Fall back to standard endpoint if enhanced isn't available
        if (!response.ok) {
          response = await fetch(`/api/predictions/${matchId}`, {
            signal: controller.signal,
          });
        }

        if (!response.ok) {
          throw new Error('Tahmin verileri alınamadı.');
        }

        const payload = await response.json();

        if (!payload.success) {
          throw new Error(payload.error || payload.message || 'Tahmin verileri alınamadı.');
        }

        if (!active) return;
        setData(payload.data);
      } catch (fetchError) {
        if (!active || (fetchError as Error).name === 'AbortError') return;
        setError((fetchError as Error).message || 'Beklenmeyen bir hata oluştu.');
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void load();
    return () => { active = false; controller.abort(); };
  }, [matchId]);

  // Loading state with Velocity Glass style
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#090e1c] flex items-center justify-center"
        style={{
          background: `
            radial-gradient(at 0% 0%, rgba(0,245,255,0.05) 0px, transparent 50%),
            radial-gradient(at 100% 0%, rgba(47,248,1,0.03) 0px, transparent 50%),
            #090e1c
          `
        }}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-[#a1faff]/30 border-t-[#a1faff] rounded-full animate-spin" />
          <p className="font-label text-sm text-[#a6aabf] tracking-wider">Analiz yapılıyor...</p>
          <p className="font-label text-[10px] text-[#434759]">4 farklı motor çalışıyor</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-[#090e1c] flex items-center justify-center p-4"
        style={{
          background: `
            radial-gradient(at 0% 0%, rgba(0,245,255,0.05) 0px, transparent 50%),
            #090e1c
          `
        }}
      >
        <div className="max-w-md w-full bg-[rgba(30,37,59,0.4)] backdrop-blur-2xl border border-[#ff716c]/20 rounded-3xl p-8 text-center">
          <span className="material-symbols-outlined text-[#ff716c] text-4xl mb-4">error</span>
          <p className="font-headline font-bold text-lg text-[#e1e4fa] mb-2">Hata</p>
          <p className="font-body text-sm text-[#a6aabf] mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-[#a1faff]/10 text-[#a1faff] rounded-full font-label text-sm hover:bg-[#a1faff]/20 transition-colors"
            >
              Tekrar Dene
            </button>
            <button
              onClick={() => router.push('/')}
              className="px-6 py-2 bg-[#1e253b] text-[#a6aabf] rounded-full font-label text-sm hover:bg-[#242b43] transition-colors"
            >
              Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render prediction
  if (data) {
    return (
      <>
        {/* Back button */}
        <div className="fixed top-4 left-4 z-50 lg:top-6 lg:left-8">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 px-4 py-2 bg-[rgba(30,37,59,0.6)] backdrop-blur-xl text-[#a1faff] rounded-full font-label text-xs hover:bg-[rgba(30,37,59,0.8)] transition-colors shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            Dashboard
          </button>
        </div>
        <VelocityGlassPrediction data={data} />
      </>
    );
  }

  return null;
}
