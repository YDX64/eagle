'use client';

import * as React from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function QueryLoading({
  label = 'Yükleniyor...',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground',
        className
      )}
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function QueryError({
  error,
  className,
}: {
  error: unknown;
  className?: string;
}) {
  const message =
    error instanceof Error ? error.message : 'Bir hata oluştu. Lütfen tekrar deneyin.';
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-md border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30 p-4',
        className
      )}
    >
      <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
      <div>
        <div className="text-sm font-semibold text-red-700 dark:text-red-300">
          Veri yüklenemedi
        </div>
        <div className="text-xs text-red-600/80 dark:text-red-300/80 mt-0.5">
          {message}
        </div>
      </div>
    </div>
  );
}

export function QueryEmpty({
  label = 'Henüz veri yok.',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-10 text-center',
        className
      )}
    >
      <Inbox className="h-5 w-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
