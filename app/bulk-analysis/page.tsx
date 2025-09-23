'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'react-hot-toast';
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

interface Stats {
  total: number;
  byTier: Record<string, number>;
}

export default function BulkAnalysisPage() {
  const [results, setResults] = useState<BulkAnalysisResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [dataTablesLoaded, setDataTablesLoaded] = useState(false);
  const [tableInstance, setTableInstance] = useState<any>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filters, setFilters] = useState({
    date: new Date().toISOString().split('T')[0],
    tier: '',
    riskLevel: '',
    league: '',
  });
  
  const tableRef = useRef<HTMLTableElement>(null);

  // Helper functions
  const getConfidenceColor = (tier: string) => {
    switch (tier) {
      case 'platinum': return 'bg-purple-100 text-purple-800';
      case 'gold': return 'bg-yellow-100 text-yellow-800';
      case 'silver': return 'bg-gray-100 text-gray-800';
      default: return 'bg-blue-100 text-blue-800';
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'low': return 'bg-green-100 text-green-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'high': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatPercentage = (value: number) => `${(value * 100).toFixed(1)}%`;

  // Load analysis results
  const loadResults = async () => {
    if (!filters.date) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({
        date: filters.date,
        ...(filters.tier && { tier: filters.tier }),
        ...(filters.riskLevel && { riskLevel: filters.riskLevel }),
        ...(filters.league && { league: filters.league }),
      });

      const response = await fetch(`/api/bulk-analysis/results?${params}`);
      const data = await response.json();

      if (data.success) {
        setResults(data.data.results || []);
        setStats(data.data.stats || null);
        
        if (data.data.results?.length === 0) {
          toast('Bu tarih için analiz sonucu bulunamadı. Lütfen analizi başlatın.');
        } else {
          toast.success(`${data.data.results?.length || 0} maç yüklendi`);
        }
      } else {
        throw new Error(data.error || 'Veriler yüklenirken hata oluştu');
      }
    } catch (error) {
      console.error('Error loading results:', error);
      toast.error('Veriler yüklenirken hata oluştu');
    } finally {
      setLoading(false);
    }
  };

  // Start bulk analysis
  const startAnalysis = async () => {
    if (!filters.date) {
      toast.error('Lütfen bir tarih seçin');
      return;
    }

    setAnalyzing(true);
    try {
      const response = await fetch(`/api/bulk-analysis?date=${filters.date}&forceRefresh=true`, {
        method: 'POST',
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast.success(`Analiz tamamlandı: ${data.count} maç analiz edildi`);
        loadResults(); // Reload results after analysis
      } else {
        throw new Error(data.error || 'Analiz sırasında hata oluştu');
      }
    } catch (error) {
      console.error('Analysis error:', error);
      toast.error('Analiz sırasında hata oluştu');
    } finally {
      setAnalyzing(false);
    }
  };

  // Initialize DataTables
  const initializeDataTable = () => {
    if (!tableRef.current || !window.$ || !window.DataTable || tableInstance) return;

    try {
      const table = window.$(tableRef.current).DataTable({
        responsive: true,
        pageLength: 25,
        lengthMenu: [[10, 25, 50, 100], [10, 25, 50, 100]],
        order: [[6, 'desc']], // Sort by confidence
        columnDefs: [
          { targets: '_all', className: 'text-center' },
          { targets: [0, 1], className: 'text-left' },
        ],
        language: {
          search: 'Ara:',
          lengthMenu: 'Sayfa başına _MENU_ kayıt göster',
          info: '_TOTAL_ kayıttan _START_ - _END_ arası gösteriliyor',
          paginate: {
            first: 'İlk',
            last: 'Son',
            next: 'Sonraki',
            previous: 'Önceki'
          },
          emptyTable: 'Tabloda veri bulunmamaktadır'
        }
      });

      setTableInstance(table);
    } catch (error) {
      console.error('DataTable initialization error:', error);
    }
  };

  // Effects
  useEffect(() => {
    loadResults();
  }, [filters.date]);

  useEffect(() => {
    if (dataTablesLoaded && results.length > 0) {
      // Clean up existing table instance
      if (tableInstance) {
        tableInstance.destroy();
        setTableInstance(null);
      }
      
      // Initialize new table
      setTimeout(initializeDataTable, 100);
    }
  }, [dataTablesLoaded, results]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Load DataTables */}
      <Script
        src="https://code.jquery.com/jquery-3.7.0.min.js"
        onLoad={() => console.log('jQuery loaded')}
      />
      <Script
        src="https://cdn.datatables.net/1.13.6/js/jquery.dataTables.min.js"
        onLoad={() => {
          console.log('DataTables loaded');
          setDataTablesLoaded(true);
        }}
      />
      <Script
        src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"
      />

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Bulk Match Analysis
        </h1>
        <p className="text-gray-600 dark:text-gray-300">
          Comprehensive football match analysis with AI-powered predictions
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Total Matches</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</p>
                </div>
                <div className="p-2 bg-blue-100 rounded-lg">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {Object.entries(stats.byTier).map(([tier, count]) => (
            <Card key={tier}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                      {tier.charAt(0).toUpperCase() + tier.slice(1)} Tier
                    </p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{count}</p>
                  </div>
                  <Badge className={getConfidenceColor(tier)}>
                    {tier}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Analysis Controls</CardTitle>
          <CardDescription>Configure and run bulk match analysis</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium mb-2">Analysis Date</label>
              <Input
                type="date"
                value={filters.date}
                onChange={(e) => setFilters({...filters, date: e.target.value})}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Confidence Tier</label>
              <Select value={filters.tier} onValueChange={(value) => setFilters({...filters, tier: value})}>
                <SelectTrigger>
                  <SelectValue placeholder="All Tiers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Tiers</SelectItem>
                  <SelectItem value="platinum">Platinum</SelectItem>
                  <SelectItem value="gold">Gold</SelectItem>
                  <SelectItem value="silver">Silver</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Risk Level</label>
              <Select value={filters.riskLevel} onValueChange={(value) => setFilters({...filters, riskLevel: value})}>
                <SelectTrigger>
                  <SelectValue placeholder="All Levels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Levels</SelectItem>
                  <SelectItem value="low">Low Risk</SelectItem>
                  <SelectItem value="medium">Medium Risk</SelectItem>
                  <SelectItem value="high">High Risk</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2 flex gap-2">
              <Button
                onClick={startAnalysis}
                disabled={analyzing || !filters.date}
                className="flex-1"
              >
                {analyzing ? 'Analyzing...' : 'Start Analysis'}
              </Button>
              
              <Button
                variant="outline"
                onClick={loadResults}
                disabled={loading}
              >
                Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Analysis Results</CardTitle>
              {results.length > 0 && (
                <CardDescription>{results.length} matches analyzed</CardDescription>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-2">Loading...</span>
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">
                Bu tarih için analiz sonucu bulunamadı. Lütfen analizi başlatın.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table 
                ref={tableRef}
                className="display responsive nowrap w-full"
                style={{ width: '100%' }}
              >
                <thead>
                  <tr>
                    <th>Home Team</th>
                    <th>Away Team</th>
                    <th>League</th>
                    <th>Time</th>
                    <th>Status</th>
                    <th>Prediction</th>
                    <th>Confidence</th>
                    <th>Tier</th>
                    <th>Risk</th>
                    <th>BTTS</th>
                    <th>O/U</th>
                    <th>Expected Value</th>
                    <th>Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result) => (
                    <tr key={result.id}>
                      <td>{result.home_team}</td>
                      <td>{result.away_team}</td>
                      <td>{result.league_name}</td>
                      <td>{result.match_time}</td>
                      <td>
                        <Badge className={result.status === 'FT' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}>
                          {result.status}
                        </Badge>
                      </td>
                      <td>
                        <Badge className="bg-blue-100 text-blue-800">
                          {result.predicted_winner || 'N/A'}
                        </Badge>
                      </td>
                      <td>{formatPercentage(result.winner_confidence || 0)}</td>
                      <td>
                        <Badge className={getConfidenceColor(result.confidence_tier || '')}>
                          {result.confidence_tier || 'N/A'}
                        </Badge>
                      </td>
                      <td>
                        <Badge className={getRiskColor(result.risk_level || '')}>
                          {result.risk_level || 'N/A'}
                        </Badge>
                      </td>
                      <td>{result.btts_prediction || 'N/A'}</td>
                      <td>{result.over_under_prediction || 'N/A'}</td>
                      <td>{formatPercentage(result.expected_value || 0)}</td>
                      <td className="max-w-xs truncate" title={result.recommendation || 'N/A'}>
                        {result.recommendation || 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}