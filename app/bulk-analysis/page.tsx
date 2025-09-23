'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

declare global {
  interface Window {
    $: any;
  }
}

interface BulkAnalysisResult {
  id: number;
  match_id: number;
  date: string;
  home_team: string;
  away_team: string;
  league_name: string;
  match_time: string;
  status: string;
  predicted_winner?: string;
  winner_confidence?: number;
  btts_prediction?: string;
  btts_confidence?: number;
  over_under_prediction?: string;
  over_under_confidence?: number;
  overall_confidence?: number;
  confidence_tier?: string;
  recommendation?: string;
  risk_level?: string;
  expected_value?: number;
  kelly_percentage?: number;
}

export default function BulkAnalysisPage() {
  const [results, setResults] = useState<BulkAnalysisResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [filters, setFilters] = useState({
    date: new Date().toISOString().split('T')[0],
    league: '',
    confidence_tier: 'all',
    risk_level: 'all'
  });
  const tableRef = useRef<HTMLTableElement>(null);
  const { toast } = useToast();

  const loadResults = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.date) params.append('date', filters.date);
      if (filters.league) params.append('league', filters.league);
      if (filters.confidence_tier && filters.confidence_tier !== 'all') params.append('confidence_tier', filters.confidence_tier);
      if (filters.risk_level && filters.risk_level !== 'all') params.append('risk_level', filters.risk_level);

      const response = await fetch(`/api/bulk-analysis/results?${params}`);
      const data = await response.json();

      if (response.ok) {
        setResults(data.results || []);
      } else {
        throw new Error(data.error || 'Failed to load results');
      }
    } catch (error) {
      console.error('Error loading results:', error);
      toast({
        title: 'Hata',
        description: 'Sonuclar yuklenirken hata olustu.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const runBulkAnalysis = async () => {
    setAnalyzing(true);
    try {
      const response = await fetch(`/api/bulk-analysis?date=${filters.date}&forceRefresh=true`, {
        method: 'POST'
      });
      const data = await response.json();

      if (response.ok) {
        toast({
          title: 'Basarili',
          description: `${data.count} mac analiz edildi.`
        });
        await loadResults();
      } else {
        throw new Error(data.error || 'Analysis failed');
      }
    } catch (error) {
      console.error('Error running analysis:', error);
      toast({
        title: 'Hata',
        description: 'Analiz sirasinda hata olustu.',
        variant: 'destructive'
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const getConfidenceBadge = (tier?: string) => {
    if (tier === 'platinum') return <Badge className="bg-purple-500 text-white">Platinum</Badge>;
    if (tier === 'gold') return <Badge className="bg-yellow-500 text-white">Gold</Badge>;
    if (tier === 'silver') return <Badge className="bg-gray-500 text-white">Silver</Badge>;
    return <Badge variant="outline">-</Badge>;
  };

  const getRiskBadge = (risk?: string) => {
    if (risk === 'low') return <Badge className="bg-green-500 text-white">Dusuk Risk</Badge>;
    if (risk === 'medium') return <Badge className="bg-yellow-500 text-white">Orta Risk</Badge>;
    if (risk === 'high') return <Badge className="bg-red-500 text-white">Yuksek Risk</Badge>;
    return <Badge variant="outline">-</Badge>;
  };

  useEffect(() => {
    loadResults();
  }, [filters]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Toplu Mac Analizi</h1>
          <p className="text-muted-foreground">Gunun tum maclari analiz edin ve sonuclari filtreleyin</p>
        </div>
        <Button 
          onClick={runBulkAnalysis} 
          disabled={analyzing}
          size="lg"
        >
          {analyzing ? 'Analiz Ediliyor...' : 'Analizi Baslat'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtreler</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="text-sm font-medium">Tarih</label>
              <Input
                type="date"
                value={filters.date}
                onChange={(e) => setFilters(prev => ({ ...prev, date: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Lig</label>
              <Input
                placeholder="Lig adi..."
                value={filters.league}
                onChange={(e) => setFilters(prev => ({ ...prev, league: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Guven Seviyesi</label>
              <Select value={filters.confidence_tier} onValueChange={(value) => setFilters(prev => ({ ...prev, confidence_tier: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Tumunu Sec" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tumunu Sec</SelectItem>
                  <SelectItem value="platinum">Platinum</SelectItem>
                  <SelectItem value="gold">Gold</SelectItem>
                  <SelectItem value="silver">Silver</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Risk Seviyesi</label>
              <Select value={filters.risk_level} onValueChange={(value) => setFilters(prev => ({ ...prev, risk_level: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Tumunu Sec" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tumunu Sec</SelectItem>
                  <SelectItem value="low">Dusuk</SelectItem>
                  <SelectItem value="medium">Orta</SelectItem>
                  <SelectItem value="high">Yuksek</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={loadResults} variant="outline" className="w-full">
                Sonuclari Yukle
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Analiz Sonuclari</CardTitle>
          <CardDescription>Toplam {results.length} mac bulundu</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">Yukleniyor...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-200">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border border-gray-200 px-4 py-2 text-left">Mac</th>
                    <th className="border border-gray-200 px-4 py-2 text-left">Lig</th>
                    <th className="border border-gray-200 px-4 py-2 text-left">Zaman</th>
                    <th className="border border-gray-200 px-4 py-2 text-left">Tahmin</th>
                    <th className="border border-gray-200 px-4 py-2 text-left">Guven</th>
                    <th className="border border-gray-200 px-4 py-2 text-left">BTTS</th>
                    <th className="border border-gray-200 px-4 py-2 text-left">U/A</th>
                    <th className="border border-gray-200 px-4 py-2 text-left">Seviye</th>
                    <th className="border border-gray-200 px-4 py-2 text-left">Risk</th>
                    <th className="border border-gray-200 px-4 py-2 text-left">Oneri</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result) => (
                    <tr key={result.id} className="hover:bg-gray-50">
                      <td className="border border-gray-200 px-4 py-2">
                        <div className="font-medium">{result.home_team}</div>
                        <div className="text-sm text-gray-600">vs {result.away_team}</div>
                      </td>
                      <td className="border border-gray-200 px-4 py-2 text-sm">{result.league_name}</td>
                      <td className="border border-gray-200 px-4 py-2 text-sm">{result.match_time}</td>
                      <td className="border border-gray-200 px-4 py-2">
                        <div className="font-medium">{result.predicted_winner || '-'}</div>
                        <div className="text-sm text-gray-600">
                          {result.winner_confidence ? `${(result.winner_confidence * 100).toFixed(1)}%` : '-'}
                        </div>
                      </td>
                      <td className="border border-gray-200 px-4 py-2">
                        {result.overall_confidence ? `${(result.overall_confidence * 100).toFixed(1)}%` : '-'}
                      </td>
                      <td className="border border-gray-200 px-4 py-2">
                        <div>{result.btts_prediction || '-'}</div>
                        <div className="text-sm text-gray-600">
                          {result.btts_confidence ? `${(result.btts_confidence * 100).toFixed(1)}%` : '-'}
                        </div>
                      </td>
                      <td className="border border-gray-200 px-4 py-2">
                        <div>{result.over_under_prediction || '-'}</div>
                        <div className="text-sm text-gray-600">
                          {result.over_under_confidence ? `${(result.over_under_confidence * 100).toFixed(1)}%` : '-'}
                        </div>
                      </td>
                      <td className="border border-gray-200 px-4 py-2">
                        {getConfidenceBadge(result.confidence_tier)}
                      </td>
                      <td className="border border-gray-200 px-4 py-2">
                        {getRiskBadge(result.risk_level)}
                      </td>
                      <td className="border border-gray-200 px-4 py-2 text-sm max-w-48">
                        {result.recommendation || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {results.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  Bu tarih icin analiz sonucu bulunamadi. Lutfen analizi baslatin.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}