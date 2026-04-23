'use client';

import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatPercent, formatRoi } from './format';

export interface RoiBarDatum {
  label: string;
  roi: number;
  total: number;
  icon?: string;
}

export interface RoiBarChartProps {
  data: RoiBarDatum[];
  layout?: 'horizontal' | 'vertical';
  height?: number;
  emptyMessage?: string;
}

function TickY({
  x,
  y,
  payload,
  data,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  data: RoiBarDatum[];
}) {
  const d = data.find(i => i.label === payload?.value);
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={12} fill="currentColor">
      {d?.icon ? `${d.icon} ` : ''}
      {payload?.value}
    </text>
  );
}

export function RoiBarChart({
  data,
  layout = 'vertical',
  height = 320,
  emptyMessage = 'Gösterilecek veri yok',
}: RoiBarChartProps) {
  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    );
  }

  const isVertical = layout === 'vertical';

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart
          data={data}
          layout={isVertical ? 'vertical' : 'horizontal'}
          margin={{ top: 8, right: 16, left: 8, bottom: isVertical ? 8 : 32 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-muted"
            opacity={0.4}
          />
          {isVertical ? (
            <>
              <XAxis
                type="number"
                tickFormatter={(v: number) => formatPercent(v, 0)}
                fontSize={11}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={140}
                tick={<TickY data={data} />}
              />
            </>
          ) : (
            <>
              <XAxis
                type="category"
                dataKey="label"
                fontSize={11}
                angle={-25}
                textAnchor="end"
              />
              <YAxis
                type="number"
                tickFormatter={(v: number) => formatPercent(v, 0)}
                fontSize={11}
              />
            </>
          )}
          <Tooltip
            cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }}
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 6,
              fontSize: 12,
            }}
            formatter={(value: unknown, name: string, item) => {
              if (name === 'roi') {
                return [formatRoi(Number(value)), 'ROI'];
              }
              return [value as number, name];
            }}
            labelFormatter={label => {
              const d = data.find(i => i.label === label);
              if (!d) return label;
              return `${d.icon ? `${d.icon} ` : ''}${label} · ${d.total} adet`;
            }}
          />
          <Bar dataKey="roi" radius={[4, 4, 4, 4]}>
            {data.map(d => (
              <Cell
                key={d.label}
                fill={
                  d.roi > 0.05
                    ? '#10b981'
                    : d.roi < -0.05
                      ? '#ef4444'
                      : '#94a3b8'
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
