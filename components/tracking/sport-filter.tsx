'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SPORT_META, type SportCode } from '@/lib/hooks/tracking/types';

export interface SportFilterProps {
  value: SportCode[];
  onChange: (next: SportCode[]) => void;
  available?: SportCode[];
  className?: string;
}

const DEFAULT_SPORTS: SportCode[] = [
  'football',
  'basketball',
  'hockey',
  'handball',
  'volleyball',
  'baseball',
];

export function SportFilter({
  value,
  onChange,
  available = DEFAULT_SPORTS,
  className,
}: SportFilterProps) {
  const toggle = (sport: SportCode) => {
    if (value.includes(sport)) {
      onChange(value.filter(s => s !== sport));
    } else {
      onChange([...value, sport]);
    }
  };

  const allOn = value.length === 0;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Button
        type="button"
        size="sm"
        variant={allOn ? 'default' : 'outline'}
        className="h-8"
        onClick={() => onChange([])}
        title="Tüm sporlar"
      >
        <span className="mr-1">🌐</span>
        Tümü
      </Button>
      {available.map(sport => {
        const meta = SPORT_META[sport];
        const selected = value.includes(sport);
        return (
          <button
            type="button"
            key={sport}
            onClick={() => toggle(sport)}
            className={cn(
              'inline-flex items-center gap-1.5 h-8 rounded-md border px-2.5 text-sm transition-colors',
              selected
                ? 'bg-primary text-primary-foreground border-transparent shadow-sm'
                : 'bg-background hover:bg-accent hover:text-accent-foreground border-input'
            )}
            aria-pressed={selected}
            title={meta.label}
          >
            <span className="text-base leading-none">{meta.icon}</span>
            <span className="hidden sm:inline">{meta.label}</span>
            {selected ? (
              <Check className="ml-0.5 h-3.5 w-3.5 opacity-80" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
