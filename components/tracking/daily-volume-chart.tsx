'use client';

import * as React from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DailyVolumeRow } from '@/lib/hooks/tracking/types';

export interface DailyVolumeChartProps {
  rows: DailyVolumeRow[];
  height?: number;
}

function formatDay(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
}

export function DailyVolumeChart({
  rows,
  height = 280,
}: DailyVolumeChartProps) {
  if (!rows.length) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
      >
        Gösterilecek günlük hacim verisi yok
      </div>
    );
  }
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart
          data={rows}
          margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-muted"
            opacity={0.4}
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatDay}
            fontSize={11}
            minTickGap={16}
          />
          <YAxis
            yAxisId="left"
            fontSize={11}
            allowDecimals={false}
            tickFormatter={v => String(v)}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            fontSize={11}
            tickFormatter={v => String(v)}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 6,
              fontSize: 12,
            }}
            labelFormatter={formatDay}
          />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            formatter={v => {
              if (v === 'total') return 'Tahmin';
              if (v === 'hit') return 'İsabet';
              if (v === 'profit') return 'Kâr (TL)';
              return v;
            }}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="total"
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="hit"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="profit"
            stroke="#f59e0b"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
