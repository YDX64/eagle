import * as React from 'react';
import { TrackingShell } from './tracking-shell';
import { TrackingQueryProvider } from '@/lib/hooks/tracking/query-provider';

export const metadata = {
  title: 'Tahmin Takip Paneli | AwaStats',
  description:
    'Çoklu spor tahmin takip paneli — ROI, isabet oranı, market performansı ve değer bahisleri.',
};

export const dynamic = 'force-dynamic';

export default function TrackingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TrackingQueryProvider>
      <React.Suspense fallback={null}>
        <TrackingShell>{children}</TrackingShell>
      </React.Suspense>
    </TrackingQueryProvider>
  );
}
