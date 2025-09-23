'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Alert,
  CircularProgress,
  Grid,
  Paper,
  IconButton,
  Tooltip,
  Stack,
  Divider,
} from '@mui/material';
import {
  Analytics,
  PlayArrow,
  Refresh,
  FilterList,
  Download,
  Visibility,
  TrendingUp,
  SportsSoccer,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import DashboardLayout from '@/components/layout/DashboardLayout';
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
      case 'platinum': return 'primary';
      case 'gold': return 'warning';
      case 'silver': return 'info';
      default: return 'default';
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'low': return 'success';
      case 'medium': return 'warning';
      case 'high': return 'error';
      default: return 'default';
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
    <DashboardLayout title="Bulk Match Analysis">
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

      <Box sx={{ mb: 4 }}>
        {/* Header Section */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h4" sx={{ mb: 1, fontWeight: 700 }}>
            Bulk Match Analysis
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Comprehensive football match analysis with AI-powered predictions
          </Typography>
        </Box>

        {/* Stats Cards */}
        {stats && (
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{ 
                      bgcolor: 'primary.main', 
                      color: 'white', 
                      p: 1, 
                      borderRadius: 2,
                      display: 'flex',
                      alignItems: 'center'
                    }}>
                      <SportsSoccer />
                    </Box>
                    <Box>
                      <Typography variant="h4" sx={{ fontWeight: 700 }}>
                        {stats.total}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Total Matches
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            
            {Object.entries(stats.byTier).map(([tier, count]) => (
              <Grid item xs={12} sm={6} md={3} key={tier}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box sx={{ 
                        bgcolor: getConfidenceColor(tier) === 'primary' ? 'primary.main' : 
                               getConfidenceColor(tier) === 'warning' ? 'warning.main' : 'info.main',
                        color: 'white', 
                        p: 1, 
                        borderRadius: 2,
                        display: 'flex',
                        alignItems: 'center'
                      }}>
                        <TrendingUp />
                      </Box>
                      <Box>
                        <Typography variant="h4" sx={{ fontWeight: 700 }}>
                          {count}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {tier.charAt(0).toUpperCase() + tier.slice(1)} Tier
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}

        {/* Controls */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Grid container spacing={3} alignItems="center">
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  type="date"
                  label="Analysis Date"
                  value={filters.date}
                  onChange={(e) => setFilters({...filters, date: e.target.value})}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              
              <Grid item xs={12} md={2}>
                <FormControl fullWidth>
                  <InputLabel>Confidence Tier</InputLabel>
                  <Select
                    value={filters.tier}
                    label="Confidence Tier"
                    onChange={(e) => setFilters({...filters, tier: e.target.value})}
                  >
                    <MenuItem value="">All Tiers</MenuItem>
                    <MenuItem value="platinum">Platinum</MenuItem>
                    <MenuItem value="gold">Gold</MenuItem>
                    <MenuItem value="silver">Silver</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} md={2}>
                <FormControl fullWidth>
                  <InputLabel>Risk Level</InputLabel>
                  <Select
                    value={filters.riskLevel}
                    label="Risk Level"
                    onChange={(e) => setFilters({...filters, riskLevel: e.target.value})}
                  >
                    <MenuItem value="">All Levels</MenuItem>
                    <MenuItem value="low">Low Risk</MenuItem>
                    <MenuItem value="medium">Medium Risk</MenuItem>
                    <MenuItem value="high">High Risk</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} md={5}>
                <Stack direction="row" spacing={2}>
                  <Button
                    variant="contained"
                    startIcon={analyzing ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />}
                    onClick={startAnalysis}
                    disabled={analyzing || !filters.date}
                    sx={{ minWidth: 140 }}
                  >
                    {analyzing ? 'Analyzing...' : 'Start Analysis'}
                  </Button>
                  
                  <Button
                    variant="outlined"
                    startIcon={<Refresh />}
                    onClick={loadResults}
                    disabled={loading}
                  >
                    Refresh
                  </Button>
                  
                  <Tooltip title="Export Results">
                    <IconButton color="primary">
                      <Download />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Results Section */}
        <Card>
          <CardContent>
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
              <Analytics color="primary" />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Analysis Results
              </Typography>
              {results.length > 0 && (
                <Chip 
                  label={`${results.length} matches`} 
                  color="primary" 
                  size="small" 
                />
              )}
            </Box>

            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : results.length === 0 ? (
              <Alert severity="info" sx={{ mt: 2 }}>
                Bu tarih için analiz sonucu bulunamadı. Lütfen analizi başlatın.
              </Alert>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <table 
                  ref={tableRef}
                  className="display responsive nowrap"
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
                          <Chip 
                            label={result.status} 
                            size="small"
                            color={result.status === 'FT' ? 'success' : 'default'}
                          />
                        </td>
                        <td>
                          <Chip 
                            label={result.predicted_winner || 'N/A'} 
                            size="small"
                            color="primary"
                          />
                        </td>
                        <td>{formatPercentage(result.winner_confidence || 0)}</td>
                        <td>
                          <Chip 
                            label={result.confidence_tier || 'N/A'} 
                            size="small"
                            color={getConfidenceColor(result.confidence_tier || '')}
                          />
                        </td>
                        <td>
                          <Chip 
                            label={result.risk_level || 'N/A'} 
                            size="small"
                            color={getRiskColor(result.risk_level || '')}
                          />
                        </td>
                        <td>{result.btts_prediction || 'N/A'}</td>
                        <td>{result.over_under_prediction || 'N/A'}</td>
                        <td>{formatPercentage(result.expected_value || 0)}</td>
                        <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {result.recommendation || 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>
    </DashboardLayout>
  );
}