'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Slider } from '@/components/ui/slider';
import { formatToStockholmDateTime, formatToStockholmTime } from '@/lib/utils';
import { CalendarDays, Filter, RefreshCw, Search } from 'lucide-react';

interface RecommendationRow {
  id: string;
  matchId: number;
  kickoffUtc: string;
  league: {
    id: number;
    name: string;
    country?: string;
  };
  homeTeam: {
    id: number;
    name: string;
  };
  awayTeam: {
    id: number;
    name: string;
  };
  title: string;
  detail: string;
  tier: string;
  confidencePercent: number;
  reasoning: string;
}

type RecommendationType = 'all' | 'over25' | 'btts';

const typeLabels: Record<RecommendationType, string> = {
  all: 'Hepsi',
  over25: 'Üst 2.5',
  btts: 'KG Var',
};

const tierStyles: Record<string, string> = {
  platinum: 'bg-emerald-600 text-white',
  gold: 'bg-amber-500 text-black',
  silver: 'bg-slate-400 text-white',
};

interface HighConfidenceGoalsTableProps {
  initialDate?: string;
}

export function HighConfidenceGoalsTable({ initialDate }: HighConfidenceGoalsTableProps = {}) {
  const [rows, setRows] = useState<RecommendationRow[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => initialDate ?? new Date().toISOString().slice(0, 10));
  const [typeFilter, setTypeFilter] = useState<RecommendationType>('all');
  const [minConfidence, setMinConfidence] = useState(70);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchRows = async (date: string, type: RecommendationType, minConf: number) => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        date,
        type,
        minConfidence: String(minConf),
      });

      const response = await fetch(`/api/recommendations/high-confidence?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.error || 'Beklenmeyen hata oluştu');
      }

      setRows(payload.data.rows ?? []);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Veri alınamadı';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows(selectedDate, typeFilter, minConfidence);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, typeFilter, minConfidence]);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return rows;

    return rows.filter((row) => {
      const haystack = `${row.league.name} ${row.league.country ?? ''} ${row.homeTeam.name} ${row.awayTeam.name} ${row.title} ${row.detail}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [rows, searchTerm]);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort(
      (a, b) => new Date(a.kickoffUtc).getTime() - new Date(b.kickoffUtc).getTime()
    );
  }, [filteredRows]);

  const handleSliderChange = (values: number[]) => {
    if (values && values.length > 0) {
      setMinConfidence(Math.round(values[0]));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <Filter className="h-5 w-5 text-emerald-600" />
            KG + Üst 2.5 Güvenli Öneriler
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="h-4 w-4" />
            {formatToStockholmDateTime(selectedDate)}
            {lastUpdated && (
              <span>
                Güncelleme: {formatToStockholmDateTime(lastUpdated)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Tarih</label>
              <Input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Oyun Türü</label>
              <div className="flex gap-2">
                {(Object.keys(typeLabels) as RecommendationType[]).map((type) => (
                  <Button
                    key={type}
                    size="sm"
                    variant={typeFilter === type ? 'default' : 'outline'}
                    className={typeFilter === type ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                    onClick={() => setTypeFilter(type)}
                  >
                    {typeLabels[type]}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span>Minimum Güven (%)</span>
                <span className="text-emerald-600 font-semibold">{minConfidence}%</span>
              </label>
              <Slider
                value={[minConfidence]}
                min={50}
                max={100}
                step={1}
                onValueChange={handleSliderChange}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Arama</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Lig, takım, öneri..."
                  className="pl-8"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchRows(selectedDate, typeFilter, minConfidence)}
              disabled={loading}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Yenile
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/30">
          <CardContent className="py-4 text-red-600 dark:text-red-300">
            {error}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-lg">
            <span>Toplam Kayıt: {sortedRows.length}</span>
            {loading && (
              <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                Yükleniyor...
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Saat (Stockholm)</TableHead>
                  <TableHead>Lig</TableHead>
                  <TableHead>Karşılaşma</TableHead>
                  <TableHead>Oyun</TableHead>
                  <TableHead className="text-right">Güven</TableHead>
                  <TableHead>Seviye</TableHead>
                  <TableHead>Öneri</TableHead>
                  <TableHead>Gerekçe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      Kriterlere uygun kayıt bulunamadı.
                    </TableCell>
                  </TableRow>
                )}

                {sortedRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {formatToStockholmTime(row.kickoffUtc)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{row.league.name}</span>
                        {row.league.country && (
                          <span className="text-xs text-muted-foreground">{row.league.country}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground">
                          {row.homeTeam.name}
                        </span>
                        <span className="text-muted-foreground text-sm">vs {row.awayTeam.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>{row.title}</TableCell>
                    <TableCell className="text-right font-semibold text-emerald-600">
                      %{row.confidencePercent.toFixed(0)}
                    </TableCell>
                    <TableCell>
                      <Badge className={tierStyles[row.tier] ?? 'bg-slate-200 text-slate-800'}>
                        {row.tier?.toUpperCase() ?? 'TIER'}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[220px] text-sm text-foreground">
                      {row.detail || '—'}
                    </TableCell>
                    <TableCell className="max-w-[260px] text-sm text-muted-foreground">
                      {row.reasoning || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
