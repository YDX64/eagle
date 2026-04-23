'use client';

import * as React from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { format, subDays } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface TrackingDateRangeValue {
  date_from?: string; // ISO date (YYYY-MM-DD)
  date_to?: string;
}

export interface TrackingDateRangePickerProps {
  value: TrackingDateRangeValue;
  onChange: (next: TrackingDateRangeValue) => void;
  className?: string;
}

function isoToDate(iso?: string): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function dateToIso(d?: Date): string | undefined {
  if (!d) return undefined;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const PRESETS: Array<{ label: string; days: number }> = [
  { label: 'Son 7 gün', days: 7 },
  { label: 'Son 14 gün', days: 14 },
  { label: 'Son 30 gün', days: 30 },
  { label: 'Son 90 gün', days: 90 },
];

export function TrackingDateRangePicker({
  value,
  onChange,
  className,
}: TrackingDateRangePickerProps) {
  const range: DateRange | undefined = React.useMemo(() => {
    const from = isoToDate(value.date_from);
    const to = isoToDate(value.date_to);
    if (!from && !to) return undefined;
    return { from, to };
  }, [value.date_from, value.date_to]);

  const handleSelect = (r: DateRange | undefined) => {
    onChange({
      date_from: dateToIso(r?.from),
      date_to: dateToIso(r?.to),
    });
  };

  const applyPreset = (days: number) => {
    const end = new Date();
    const start = subDays(end, days);
    onChange({
      date_from: dateToIso(start),
      date_to: dateToIso(end),
    });
  };

  const label = range?.from
    ? range.to
      ? `${format(range.from, 'dd LLL yyyy', { locale: tr })} - ${format(range.to, 'dd LLL yyyy', { locale: tr })}`
      : format(range.from, 'dd LLL yyyy', { locale: tr })
    : 'Tarih aralığı seçin';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'justify-start text-left font-normal h-9 min-w-[220px]',
            !range && 'text-muted-foreground',
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-row sm:flex-col gap-1 p-2 border-b sm:border-b-0 sm:border-r border-border min-w-[140px]">
            {PRESETS.map(p => (
              <Button
                key={p.days}
                variant="ghost"
                size="sm"
                className="justify-start text-sm"
                onClick={() => applyPreset(p.days)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Calendar
            mode="range"
            defaultMonth={range?.from}
            selected={range}
            onSelect={handleSelect}
            numberOfMonths={2}
            locale={tr}
            initialFocus
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
