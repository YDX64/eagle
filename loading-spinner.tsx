
'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
};

export function LoadingSpinner({ className, size = 'md', text }: LoadingSpinnerProps) {
  return (
    <div className={cn('flex items-center justify-center gap-2', className)}>
      <Loader2 className={cn('animate-spin', sizeClasses[size])} />
      {text && (
        <span className="text-sm text-muted-foreground">{text}</span>
      )}
    </div>
  );
}

export function LoadingCard({ title, description }: { title?: string; description?: string }) {
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
      <div className="flex items-center justify-center space-y-2 flex-col">
        <LoadingSpinner size="lg" />
        {title && <h3 className="font-semibold">{title}</h3>}
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}
