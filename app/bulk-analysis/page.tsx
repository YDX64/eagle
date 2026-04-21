'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'react-hot-toast';
import { Search, Filter, Download, RefreshCw, Play } from 'lucide-react';

interface BulkAnalysisResult {
  id: number;
  match_id: number;
  date: string;
  home_team: string;
  away_team: string;
  league_name: string;
  match_time: string;
  status: string;
  
  // Prediction Data
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
  home_form_score?: number;
  away_form_score?: number;
  head_to_head_score?: number;
  home_advantage?: number;
  goals_analysis?: number;
  
  // API Football Match Statistics
  api_ms_home_shots_on_goal?: number;
  api_ms_home_shots_off_goal?: number;
  api_ms_home_total_shots?: number;
  api_ms_home_ball_possession?: string;
  api_ms_home_yellow_cards?: number;
  api_ms_home_red_cards?: number;
  api_ms_home_corner_kicks?: number;
  api_ms_home_fouls?: number;
  api_ms_away_shots_on_goal?: number;
  api_ms_away_shots_off_goal?: number;
  api_ms_away_total_shots?: number;
  api_ms_away_ball_possession?: string;
  api_ms_away_yellow_cards?: number;
  api_ms_away_red_cards?: number;
  api_ms_away_corner_kicks?: number;
  api_ms_away_fouls?: number;
  
  // API Football Form Data
  api_form_home_last_5?: string;
  api_form_home_wins_last_5?: number;
  api_form_home_losses_last_5?: number;
  api_form_away_last_5?: string;
  api_form_away_wins_last_5?: number;
  api_form_away_losses_last_5?: number;
  
  // API Football Head-to-Head
  api_h2h_total_matches?: number;
  api_h2h_home_wins?: number;
  api_h2h_away_wins?: number;
  api_h2h_draws?: number;
  api_h2h_avg_goals_per_match?: number;
  
  // API Football League Data
  api_league_home_position?: number;
  api_league_away_position?: number;
  api_league_home_points?: number;
  api_league_away_points?: number;
  api_league_avg_goals_home?: number;
  api_league_avg_goals_away?: number;
  
  // Our Analysis
  own_an_value_score?: number;
  own_an_momentum_score?: number;
  own_an_injury_impact?: number;
  own_an_weather_impact?: number;
  own_an_referee_tendency?: number;
  own_an_crowd_factor?: number;
  
  // Risk Analysis
  risk_variance_score?: number;
  risk_liquidity_score?: number;
  risk_odds_movement?: number;
  risk_last_minute_changes?: number;
  
  // Performance Metrics
  perf_historical_accuracy?: number;
  perf_recent_form_weight?: number;
  perf_league_specific_adj?: number;
  perf_algorithm_confidence?: number;
  
  // Market Data
  market_odds_home?: number;
  market_odds_away?: number;
  market_odds_draw?: number;
  market_volume_indicator?: number;
  market_smart_money_flow?: number;
  
  createdAt?: string;
  updatedAt?: string;
}

interface Stats {
  total: number;
  byTier: Record<string, number>;
}

interface ColumnFilter {
  field: string;
  operator: 'equals' | 'contains' | 'greater' | 'less' | 'between';
  value: string | number;
  value2?: string | number; // for between operator
}

export default function BulkAnalysisPage() {
  const [results, setResults] = useState<BulkAnalysisResult[]>([]);
  const [filteredResults, setFilteredResults] = useState<BulkAnalysisResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filters, setFilters] = useState({
    date: new Date().toISOString().split('T')[0],
    tier: '',
    riskLevel: '',
    league: '',
    search: '',
  });
  
  const [columnFilters, setColumnFilters] = useState<ColumnFilter[]>([]);
  const [sortConfig, setSortConfig] = useState({ field: '', direction: 'asc' });
  const [selectedCategories, setSelectedCategories] = useState<string[]>([
    'basic', 'predictions', 'api_ms', 'api_form', 'api_h2h', 'api_league', 'own_an', 'risk', 'perf', 'market'
  ]);

  // Column definitions by category
  const columnCategories = {
    basic: {
      title: 'Basic Info',
      columns: [
        { key: 'home_team', label: 'Home Team', type: 'text' },
        { key: 'away_team', label: 'Away Team', type: 'text' },
        { key: 'league_name', label: 'League', type: 'text' },
        { key: 'match_time', label: 'Time', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
      ]
    },
    predictions: {
      title: 'Predictions & Analysis',
      columns: [
        { key: 'predicted_winner', label: 'Winner', type: 'text' },
        { key: 'winner_confidence', label: 'Win Conf%', type: 'number' },
        { key: 'btts_prediction', label: 'BTTS', type: 'text' },
        { key: 'btts_confidence', label: 'BTTS Conf%', type: 'number' },
        { key: 'over_under_prediction', label: 'O/U', type: 'text' },
        { key: 'over_under_confidence', label: 'O/U Conf%', type: 'number' },
        { key: 'overall_confidence', label: 'Overall%', type: 'number' },
        { key: 'confidence_tier', label: 'Tier', type: 'text' },
        { key: 'risk_level', label: 'Risk', type: 'text' },
        { key: 'expected_value', label: 'EV%', type: 'number' },
        { key: 'kelly_percentage', label: 'Kelly%', type: 'number' },
        { key: 'home_form_score', label: 'Home Form', type: 'number' },
        { key: 'away_form_score', label: 'Away Form', type: 'number' },
        { key: 'head_to_head_score', label: 'H2H Score', type: 'number' },
        { key: 'home_advantage', label: 'Home Adv', type: 'number' },
        { key: 'goals_analysis', label: 'Goals', type: 'number' },
      ]
    },
    api_ms: {
      title: 'API Match Statistics',
      columns: [
        { key: 'api_ms_home_shots_on_goal', label: 'H Shots On', type: 'number' },
        { key: 'api_ms_home_shots_off_goal', label: 'H Shots Off', type: 'number' },
        { key: 'api_ms_home_total_shots', label: 'H Total Shots', type: 'number' },
        { key: 'api_ms_home_ball_possession', label: 'H Possession', type: 'text' },
        { key: 'api_ms_home_yellow_cards', label: 'H Yellow', type: 'number' },
        { key: 'api_ms_home_red_cards', label: 'H Red', type: 'number' },
        { key: 'api_ms_home_corner_kicks', label: 'H Corners', type: 'number' },
        { key: 'api_ms_home_fouls', label: 'H Fouls', type: 'number' },
        { key: 'api_ms_away_shots_on_goal', label: 'A Shots On', type: 'number' },
        { key: 'api_ms_away_shots_off_goal', label: 'A Shots Off', type: 'number' },
        { key: 'api_ms_away_total_shots', label: 'A Total Shots', type: 'number' },
        { key: 'api_ms_away_ball_possession', label: 'A Possession', type: 'text' },
        { key: 'api_ms_away_yellow_cards', label: 'A Yellow', type: 'number' },
        { key: 'api_ms_away_red_cards', label: 'A Red', type: 'number' },
        { key: 'api_ms_away_corner_kicks', label: 'A Corners', type: 'number' },
        { key: 'api_ms_away_fouls', label: 'A Fouls', type: 'number' },
      ]
    },
    api_form: {
      title: 'API Form Data',
      columns: [
        { key: 'api_form_home_last_5', label: 'H Last 5', type: 'text' },
        { key: 'api_form_home_wins_last_5', label: 'H Wins 5', type: 'number' },
        { key: 'api_form_home_losses_last_5', label: 'H Losses 5', type: 'number' },
        { key: 'api_form_away_last_5', label: 'A Last 5', type: 'text' },
        { key: 'api_form_away_wins_last_5', label: 'A Wins 5', type: 'number' },
        { key: 'api_form_away_losses_last_5', label: 'A Losses 5', type: 'number' },
      ]
    },
    api_h2h: {
      title: 'API Head-to-Head',
      columns: [
        { key: 'api_h2h_total_matches', label: 'H2H Total', type: 'number' },
        { key: 'api_h2h_home_wins', label: 'H2H Home W', type: 'number' },
        { key: 'api_h2h_away_wins', label: 'H2H Away W', type: 'number' },
        { key: 'api_h2h_draws', label: 'H2H Draws', type: 'number' },
        { key: 'api_h2h_avg_goals_per_match', label: 'H2H Avg Goals', type: 'number' },
      ]
    },
    api_league: {
      title: 'API League Data',
      columns: [
        { key: 'api_league_home_position', label: 'H Position', type: 'number' },
        { key: 'api_league_away_position', label: 'A Position', type: 'number' },
        { key: 'api_league_home_points', label: 'H Points', type: 'number' },
        { key: 'api_league_away_points', label: 'A Points', type: 'number' },
        { key: 'api_league_avg_goals_home', label: 'H Avg Goals', type: 'number' },
        { key: 'api_league_avg_goals_away', label: 'A Avg Goals', type: 'number' },
      ]
    },
    own_an: {
      title: 'Our Analysis',
      columns: [
        { key: 'own_an_value_score', label: 'Value Score', type: 'number' },
        { key: 'own_an_momentum_score', label: 'Momentum', type: 'number' },
        { key: 'own_an_injury_impact', label: 'Injury Impact', type: 'number' },
        { key: 'own_an_weather_impact', label: 'Weather', type: 'number' },
        { key: 'own_an_referee_tendency', label: 'Referee', type: 'number' },
        { key: 'own_an_crowd_factor', label: 'Crowd', type: 'number' },
      ]
    },
    risk: {
      title: 'Risk Analysis',
      columns: [
        { key: 'risk_variance_score', label: 'Variance', type: 'number' },
        { key: 'risk_liquidity_score', label: 'Liquidity', type: 'number' },
        { key: 'risk_odds_movement', label: 'Odds Move', type: 'number' },
        { key: 'risk_last_minute_changes', label: 'Last Min', type: 'number' },
      ]
    },
    perf: {
      title: 'Performance Metrics',
      columns: [
        { key: 'perf_historical_accuracy', label: 'Hist Acc', type: 'number' },
        { key: 'perf_recent_form_weight', label: 'Form Weight', type: 'number' },
        { key: 'perf_league_specific_adj', label: 'League Adj', type: 'number' },
        { key: 'perf_algorithm_confidence', label: 'Algo Conf', type: 'number' },
      ]
    },
    market: {
      title: 'Market Data',
      columns: [
        { key: 'market_odds_home', label: 'Odds Home', type: 'number' },
        { key: 'market_odds_away', label: 'Odds Away', type: 'number' },
        { key: 'market_odds_draw', label: 'Odds Draw', type: 'number' },
        { key: 'market_volume_indicator', label: 'Volume', type: 'number' },
        { key: 'market_smart_money_flow', label: 'Smart Money', type: 'number' },
      ]
    }
  };

  // Helper functions
  const getConfidenceColor = (tier: string) => {
    switch (tier) {
      case 'platinum': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'gold': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'silver': return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
      default: return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'low': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'high': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  const formatValue = (value: any, type: string) => {
    if (value === null || value === undefined) return 'N/A';
    if (type === 'number') {
      return typeof value === 'number' ? value.toFixed(3) : 'N/A';
    }
    return String(value);
  };

  // Load analysis results  
  const loadResults = async () => {
    if (!filters.date) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({
        date: filters.date,
        limit: '1000', // Load more data for Excel-like experience
        ...(filters.tier && { tier: filters.tier }),
        ...(filters.riskLevel && { riskLevel: filters.riskLevel }),
        ...(filters.league && { league: filters.league }),
      });

      const response = await fetch(`/api/bulk-analysis/results?${params}`);
      const data = await response.json();

      if (data.success) {
        setResults(data.data.results || []);
        setStats(data.data.stats || null);
        applyFilters(data.data.results || []);
        
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
        loadResults();
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

  // Apply all filters
  const applyFilters = (data: BulkAnalysisResult[]) => {
    let filtered = [...data];

    // Apply search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(result => 
        result.home_team?.toLowerCase().includes(searchLower) ||
        result.away_team?.toLowerCase().includes(searchLower) ||
        result.league_name?.toLowerCase().includes(searchLower)
      );
    }

    // Apply column filters
    columnFilters.forEach(filter => {
      filtered = filtered.filter(result => {
        const value = result[filter.field as keyof BulkAnalysisResult];
        if (value === null || value === undefined) return false;
        
        switch (filter.operator) {
          case 'equals':
            return String(value) === String(filter.value);
          case 'contains':
            return String(value).toLowerCase().includes(String(filter.value).toLowerCase());
          case 'greater':
            return Number(value) > Number(filter.value);
          case 'less':
            return Number(value) < Number(filter.value);
          case 'between':
            return Number(value) >= Number(filter.value) && Number(value) <= Number(filter.value2 || 0);
          default:
            return true;
        }
      });
    });

    // Apply sorting
    if (sortConfig.field) {
      filtered.sort((a, b) => {
        const aVal = a[sortConfig.field as keyof BulkAnalysisResult];
        const bVal = b[sortConfig.field as keyof BulkAnalysisResult];
        
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        
        const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sortConfig.direction === 'desc' ? -comparison : comparison;
      });
    }

    setFilteredResults(filtered);
  };

  // Handle sorting
  const handleSort = (field: string) => {
    const direction = sortConfig.field === field && sortConfig.direction === 'asc' ? 'desc' : 'asc';
    setSortConfig({ field, direction });
  };

  // Export to CSV
  const exportToCSV = () => {
    if (filteredResults.length === 0) return;

    // Fix category key mapping - use actual keys from Object.keys instead of transformed titles
    const columns = Object.entries(columnCategories)
      .filter(([key, _]) => selectedCategories.includes(key))
      .flatMap(([_, cat]) => cat.columns);
    
    const headers = columns.map(col => col.label);
    const csvData = filteredResults.map(result => 
      columns.map(col => {
        const value = formatValue(result[col.key as keyof BulkAnalysisResult], col.type);
        // Escape commas in CSV values
        return value.includes(',') ? `"${value}"` : value;
      })
    );

    const csvContent = [headers, ...csvData].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `football_analysis_${filters.date}_${filteredResults.length}matches.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Effects
  useEffect(() => {
    loadResults();
  }, [filters.date]);

  useEffect(() => {
    applyFilters(results);
  }, [results, filters.search, columnFilters, sortConfig]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          📊 Excel-Style Bulk Analysis
        </h1>
        <p className="text-gray-600 dark:text-gray-300">
          Ultra detaylı analiz verileri - 50+ kategorili alan ve gelişmiş filtreleme
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
                  <Search className="w-6 h-6 text-blue-600" />
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
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Analysis Controls & Filters
          </CardTitle>
          <CardDescription>Excel-like filtering and data management</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
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
              <Select value={filters.tier || undefined} onValueChange={(value) => setFilters({...filters, tier: value || ''})}>
                <SelectTrigger>
                  <SelectValue placeholder="All Tiers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="platinum">Platinum</SelectItem>
                  <SelectItem value="gold">Gold</SelectItem>
                  <SelectItem value="silver">Silver</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Risk Level</label>
              <Select value={filters.riskLevel || undefined} onValueChange={(value) => setFilters({...filters, riskLevel: value || ''})}>
                <SelectTrigger>
                  <SelectValue placeholder="All Levels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low Risk</SelectItem>
                  <SelectItem value="medium">Medium Risk</SelectItem>
                  <SelectItem value="high">High Risk</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Global Search</label>
              <Input
                placeholder="Search teams, leagues..."
                value={filters.search}
                onChange={(e) => setFilters({...filters, search: e.target.value})}
              />
            </div>

            <div className="md:col-span-2 flex gap-2">
              <Button
                onClick={startAnalysis}
                disabled={analyzing || !filters.date}
                className="flex-1"
              >
                <Play className="w-4 h-4 mr-2" />
                {analyzing ? 'Analyzing...' : 'Start Analysis'}
              </Button>
              
              <Button
                variant="outline"
                onClick={loadResults}
                disabled={loading}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>

              <Button
                variant="outline"
                onClick={exportToCSV}
                disabled={filteredResults.length === 0}
              >
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>

          {/* Category Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">Data Categories to Show</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(columnCategories).map(([key, category]) => (
                <Button
                  key={key}
                  variant={selectedCategories.includes(key) ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    if (selectedCategories.includes(key)) {
                      setSelectedCategories(selectedCategories.filter(c => c !== key));
                    } else {
                      setSelectedCategories([...selectedCategories, key]);
                    }
                  }}
                >
                  {category.title} ({category.columns.length})
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Ultra Detailed Analysis Results</CardTitle>
              {filteredResults.length > 0 && (
                <CardDescription>
                  {filteredResults.length} matches shown (filtered from {results.length} total)
                </CardDescription>
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
          ) : filteredResults.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">
                Bu tarih için analiz sonucu bulunamadı. Lütfen analizi başlatın.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-max">
                {/* Table Header */}
                <div className="grid gap-1 mb-2" style={{ gridTemplateColumns: `repeat(${Object.values(columnCategories).filter(cat => selectedCategories.includes(Object.keys(columnCategories).find(k => columnCategories[k as keyof typeof columnCategories] === cat) || '')).flatMap(cat => cat.columns).length}, minmax(120px, 1fr))` }}>
                  {Object.entries(columnCategories)
                    .filter(([key]) => selectedCategories.includes(key))
                    .map(([categoryKey, category]) => (
                      <div key={categoryKey} className="col-span-full">
                        <div className="bg-blue-50 dark:bg-blue-900 p-2 rounded mb-1">
                          <h3 className="font-semibold text-sm text-blue-800 dark:text-blue-200">
                            {category.title}
                          </h3>
                        </div>
                        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${category.columns.length}, minmax(120px, 1fr))` }}>
                          {category.columns.map((column) => (
                            <div
                              key={column.key}
                              className="bg-gray-50 dark:bg-gray-800 p-2 text-xs font-medium cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 border rounded"
                              onClick={() => handleSort(column.key)}
                            >
                              <div className="flex items-center justify-between">
                                <span>{column.label}</span>
                                {sortConfig.field === column.key && (
                                  <span className="text-blue-600">
                                    {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>

                {/* Table Data */}
                <div className="space-y-1">
                  {filteredResults.map((result) => (
                    <div key={result.id} className="grid gap-1 hover:bg-gray-50 dark:hover:bg-gray-800 p-1 rounded border" style={{ gridTemplateColumns: `repeat(${Object.values(columnCategories).filter(cat => selectedCategories.includes(Object.keys(columnCategories).find(k => columnCategories[k as keyof typeof columnCategories] === cat) || '')).flatMap(cat => cat.columns).length}, minmax(120px, 1fr))` }}>
                      {Object.entries(columnCategories)
                        .filter(([key]) => selectedCategories.includes(key))
                        .flatMap(([_, category]) => category.columns)
                        .map((column) => (
                          <div key={column.key} className="p-2 text-xs border-r border-gray-200 dark:border-gray-700">
                            {column.key === 'confidence_tier' ? (
                              <Badge className={getConfidenceColor(String(result[column.key as keyof BulkAnalysisResult] || ''))}>
                                {formatValue(result[column.key as keyof BulkAnalysisResult], column.type)}
                              </Badge>
                            ) : column.key === 'risk_level' ? (
                              <Badge className={getRiskColor(String(result[column.key as keyof BulkAnalysisResult] || ''))}>
                                {formatValue(result[column.key as keyof BulkAnalysisResult], column.type)}
                              </Badge>
                            ) : (
                              <span className={`${column.type === 'number' ? 'font-mono' : ''}`}>
                                {formatValue(result[column.key as keyof BulkAnalysisResult], column.type)}
                              </span>
                            )}
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}