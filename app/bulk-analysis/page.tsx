'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import Script from 'next/script';

declare global {
  interface Window {
    $: any;
    DataTable: any;
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
  
  // API Football kategorili veriler
  api_ms_home_shots_on_goal?: number;
  api_ms_home_total_shots?: number;
  api_ms_home_ball_possession?: string;
  api_ms_away_shots_on_goal?: number;
  api_ms_away_total_shots?: number;
  api_ms_away_ball_possession?: string;
  api_form_home_last_5?: string;
  api_form_away_last_5?: string;
  api_h2h_total_matches?: number;
  api_h2h_home_wins?: number;
  api_h2h_away_wins?: number;
  api_league_home_position?: number;
  api_league_away_position?: number;
  
  // Kendi analiz kategorileri
  own_an_value_score?: number;
  own_an_momentum_score?: number;
  risk_variance_score?: number;
  risk_liquidity_score?: number;
  perf_historical_accuracy?: number;
  perf_algorithm_confidence?: number;
  market_odds_home?: number;
  market_odds_away?: number;
  market_odds_draw?: number;
}

export default function BulkAnalysisPage() {
  const [results, setResults] = useState<BulkAnalysisResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [dataTablesLoaded, setDataTablesLoaded] = useState(false);
  const [tableInstance, setTableInstance] = useState<any>(null);
  const [filters, setFilters] = useState({
    date: new Date().toISOString().split('T')[0],
    league: '',
    confidence_tier: 'all',
    risk_level: 'all'
  });
  const tableRef = useRef<HTMLTableElement>(null);
  const { toast } = useToast();

  const initializeDataTable = () => {
    if (dataTablesLoaded && tableRef.current && results.length > 0) {
      // Destroy existing table if it exists
      if (tableInstance) {
        tableInstance.destroy();
      }

      // Initialize DataTable
      const newTableInstance = window.$(tableRef.current).DataTable({
        data: results,
        responsive: true,
        pageLength: 25,
        lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "Tümü"]],
        language: {
          search: "Ara:",
          lengthMenu: "_MENU_ kayıt göster",
          info: "_START_ - _END_ / _TOTAL_ kayıt",
          infoEmpty: "0 kayıt",
          infoFiltered: "(_MAX_ kayıttan filtrelendi)",
          paginate: {
            first: "İlk",
            last: "Son",
            next: "Sonraki",
            previous: "Önceki"
          },
          emptyTable: "Tabloda veri yok"
        },
        columns: [
          { 
            title: "Maç", 
            data: null,
            render: function(data: any) {
              return `<div class="font-medium">${data.home_team}</div><div class="text-sm text-gray-600">vs ${data.away_team}</div>`;
            }
          },
          { title: "Lig", data: "league_name" },
          { title: "Saat", data: "match_time" },
          { 
            title: "Tahmin", 
            data: null,
            render: function(data: any) {
              return `<div class="font-medium">${data.predicted_winner || '-'}</div><div class="text-sm text-gray-600">${data.winner_confidence ? (data.winner_confidence * 100).toFixed(1) + '%' : '-'}</div>`;
            }
          },
          { 
            title: "Güven Seviyesi", 
            data: null,
            render: function(data: any) {
              const tier = data.confidence_tier;
              let badgeClass = 'px-2 py-1 rounded-full text-xs font-medium';
              if (tier === 'platinum') badgeClass += ' category-api-ms';
              else if (tier === 'gold') badgeClass += ' category-perf';
              else if (tier === 'silver') badgeClass += ' category-market';
              else badgeClass += ' category-badge';
              return `<span class="${badgeClass}">${tier || '-'}</span>`;
            }
          },
          { 
            title: "Risk", 
            data: null,
            render: function(data: any) {
              const risk = data.risk_level;
              let badgeClass = 'px-2 py-1 rounded-full text-xs font-medium';
              if (risk === 'low') badgeClass += ' category-own-an';
              else if (risk === 'medium') badgeClass += ' category-perf';
              else if (risk === 'high') badgeClass += ' category-risk';
              else badgeClass += ' category-badge';
              return `<span class="${badgeClass}">${risk === 'low' ? 'Düşük' : risk === 'medium' ? 'Orta' : risk === 'high' ? 'Yüksek' : '-'}</span>`;
            }
          },
          { 
            title: "API-MS Şutlar", 
            data: null,
            render: function(data: any) {
              return `<span class="category-badge category-api-ms">${data.api_ms_home_shots_on_goal || 0} - ${data.api_ms_away_shots_on_goal || 0}</span>`;
            }
          },
          { 
            title: "API-Form", 
            data: null,
            render: function(data: any) {
              return `<span class="category-badge category-api-form">${data.api_form_home_last_5 || '-'} vs ${data.api_form_away_last_5 || '-'}</span>`;
            }
          },
          { 
            title: "API-Lig Poz.", 
            data: null,
            render: function(data: any) {
              return `<span class="category-badge category-api-league">${data.api_league_home_position || '-'} vs ${data.api_league_away_position || '-'}</span>`;
            }
          },
          { 
            title: "Own-Değer", 
            data: null,
            render: function(data: any) {
              return `<span class="category-badge category-own-an">${data.own_an_value_score ? data.own_an_value_score.toFixed(2) : '-'}</span>`;
            }
          },
          { 
            title: "Risk-Var", 
            data: null,
            render: function(data: any) {
              return `<span class="category-badge category-risk">${data.risk_variance_score ? data.risk_variance_score.toFixed(2) : '-'}</span>`;
            }
          },
          { 
            title: "Market Oranlar", 
            data: null,
            render: function(data: any) {
              return `<span class="category-badge category-market">${data.market_odds_home || '-'} | ${data.market_odds_draw || '-'} | ${data.market_odds_away || '-'}</span>`;
            }
          }
        ],
        order: [[4, "desc"]] // Order by confidence tier
      });

      setTableInstance(newTableInstance);
    }
  };

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

  // Initialize DataTable when data loads
  useEffect(() => {
    if (results.length > 0) {
      setTimeout(() => {
        initializeDataTable();
      }, 100);
    }
  }, [results, dataTablesLoaded]);

  useEffect(() => {
    loadResults();
  }, [filters]);

  return (
    <>
      <Script 
        src="https://code.jquery.com/jquery-3.7.1.min.js" 
        onLoad={() => console.log('jQuery loaded')}
      />
      <Script 
        src="https://cdn.datatables.net/1.13.6/js/jquery.dataTables.min.js"
        onLoad={() => {
          setDataTablesLoaded(true);
          console.log('DataTables loaded');
        }}
      />
      <Script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js" />
      
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Toplu Maç Analizi</h1>
            <p className="text-muted-foreground">Günün tüm maçları analiz edin ve sonuçları kategorili şekilde filtreleyin</p>
          </div>
          <Button 
            onClick={runBulkAnalysis} 
            disabled={analyzing}
            size="lg"
          >
            {analyzing ? 'Analiz Ediliyor...' : 'Analizi Başlat'}
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
            <div className="text-center py-8">Yükleniyor...</div>
          ) : (
            <div className="overflow-x-auto">
              <table ref={tableRef} className="w-full display responsive nowrap" style={{width: '100%'}}>
                {/* DataTables will populate this automatically */}
              </table>
              
              {results.length === 0 && !dataTablesLoaded && (
                <div className="text-center py-8 text-gray-500">
                  Bu tarih için analiz sonucu bulunamadı. Lütfen analizi başlatın.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </>
  );
}