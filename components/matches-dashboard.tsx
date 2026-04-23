
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { MatchCard } from './match-card';
import { HighConfidenceGoalsTable } from './high-confidence-goals-table';
import { PredictionModal } from './prediction-modal';
import { OptimizedMatchListEnhanced } from './optimized-match-list-enhanced';
import { GoalAnalyzerPanel } from './goal-analyzer-panel';
import { ThemeToggle } from './theme-toggle';
import { Pagination } from './pagination';
import { ClientWrapper } from './client-wrapper';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  CalendarDays,
  Activity,
  Trophy,
  Search,
  RefreshCw,
  TrendingUp,
  Clock,
  Calendar,
  Users,
  Target,
  History,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChartBar
} from 'lucide-react';
import Link from 'next/link';
import { Fixture } from '@/lib/api-football';
import { PredictionOutcome } from './match-card';
import {
  formatToStockholmTime,
  formatToStockholmDate,
  formatToStockholmDateTime,
  PaginationResult
} from '@/lib/utils';
import { Settings } from 'lucide-react';

interface ApiStats {
  totalMatches: number;
  liveMatches: number;
  upcomingMatches: number;
  finishedMatches: number;
}

interface ApiPagination {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  itemsPerPage: number;
}

export function MatchesDashboard() {
  const router = useRouter();
  // Core state
  const [matches, setMatches] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('matches');

  // Enhanced filtering and pagination state
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<ApiPagination | null>(null);
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'upcoming' | 'finished'>('all');
  const [leagueFilter, setLeagueFilter] = useState<string>('all');
  const [lowRiskOnly, setLowRiskOnly] = useState(false);

  // Ended matches functionality
  const [endedMatchesHours, setEndedMatchesHours] = useState(0);
  const [showEndedMatches, setShowEndedMatches] = useState(false);

  // Prediction outcomes for finished matches
  const [predictionOutcomes, setPredictionOutcomes] = useState<Record<number, PredictionOutcome[]>>({});

  const fetchMatches = async (
    date: string, 
    page = 1, 
    search = '', 
    endedHours = 0
  ) => {
    try {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams({
        date,
        page: page.toString(),
        limit: '10000', // No limit - show all matches
        search,
        endedMatchesHours: endedHours.toString()
      });
      
      
      const response = await fetch(`/api/matches/today?${params}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        const matchesData = data.data?.matches || [];
        setMatches(matchesData);
        setPagination(data.data?.pagination || data.pagination);
        setStats(data.data?.stats || data.stats);
        
      } else {
        const errorMsg = data.error || 'Failed to fetch matches';
        setError(errorMsg);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Network error occurred';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchMatches(selectedDate, currentPage, searchTerm, endedMatchesHours);
    setRefreshing(false);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    fetchMatches(selectedDate, page, searchTerm, endedMatchesHours);
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1); // Reset to first page when searching
    fetchMatches(selectedDate, 1, value, endedMatchesHours);
  };

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    setCurrentPage(1);
    setEndedMatchesHours(0);
    setShowEndedMatches(false);
    fetchMatches(date, 1, searchTerm, 0);
  };

  const handleEndedMatchesNavigation = (direction: 'prev' | 'next') => {
    const newHours = direction === 'next' 
      ? Math.max(0, endedMatchesHours - 2)
      : endedMatchesHours + 2;
    
    setEndedMatchesHours(newHours);
    setCurrentPage(1);
    fetchMatches(selectedDate, 1, searchTerm, newHours);
  };

  const toggleEndedMatches = () => {
    const newShowEnded = !showEndedMatches;
    setShowEndedMatches(newShowEnded);
    
    if (newShowEnded) {
      setEndedMatchesHours(2); // Start with 2 hours ago
      setCurrentPage(1);
      fetchMatches(selectedDate, 1, searchTerm, 2);
    } else {
      setEndedMatchesHours(0);
      setCurrentPage(1);
      fetchMatches(selectedDate, 1, searchTerm, 0);
    }
  };

  // Fetch prediction outcomes for finished matches
  const fetchPredictionOutcomes = async (finishedMatchIds: number[]) => {
    if (finishedMatchIds.length === 0) return;
    try {
      const response = await fetch(`/api/predictions/history?matchIds=${finishedMatchIds.join(',')}&limit=500`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.success && data.data?.predictions) {
        const outcomeMap: Record<number, PredictionOutcome[]> = {};
        for (const p of data.data.predictions) {
          if (!outcomeMap[p.matchId]) outcomeMap[p.matchId] = [];
          outcomeMap[p.matchId].push({
            predictionType: p.predictionType,
            predictedValue: p.predictedValue,
            isCorrect: p.isCorrect,
            actualResult: p.actualResult,
            confidenceScore: p.confidenceScore,
            confidenceTier: p.confidenceTier,
          });
        }
        setPredictionOutcomes(prev => ({ ...prev, ...outcomeMap }));
      }
    } catch {
      // Silent fail - badge'ler gösterilmez
    }
  };

  // When matches change, fetch prediction outcomes for finished ones
  useEffect(() => {
    const finishedIds = safeMatches
      .filter(m => m?.fixture?.status?.short === 'FT')
      .map(m => m.fixture.id);
    if (finishedIds.length > 0) {
      fetchPredictionOutcomes(finishedIds);
    }
  }, [matches]);

  // Initial load and date changes
  useEffect(() => {
    fetchMatches(selectedDate, currentPage, searchTerm, endedMatchesHours);
  }, []);

  // Auto-refresh for live matches every 30 seconds
  useEffect(() => {
    const hasLiveMatches = stats?.liveMatches && stats.liveMatches > 0;
    if (hasLiveMatches && !showEndedMatches) {
      const interval = setInterval(() => {
        console.log('[Auto-refresh] Updating live matches...');
        fetchMatches(selectedDate, currentPage, searchTerm, endedMatchesHours);
      }, 30000); // 30 seconds

      return () => clearInterval(interval);
    }
  }, [stats?.liveMatches, selectedDate, currentPage, searchTerm, endedMatchesHours, showEndedMatches]);

  // Enhanced match categorization based on API stats with safety checks
  const safeMatches = Array.isArray(matches) ? matches : [];

  // Sort all matches by timestamp (earliest first)
  const sortedMatches = [...safeMatches].sort((a, b) => {
    const timeA = a?.fixture?.timestamp || 0;
    const timeB = b?.fixture?.timestamp || 0;
    return timeA - timeB;
  });

  const liveMatches = sortedMatches.filter(m =>
    m && m.fixture && m.fixture.status && ['1H', '2H', 'HT'].includes(m.fixture.status.short)
  );

  const upcomingMatches = sortedMatches.filter(m =>
    m && m.fixture && m.fixture.status && m.fixture.status.short === 'NS'
  );

  const finishedMatches = sortedMatches.filter(m =>
    m && m.fixture && m.fixture.status && m.fixture.status.short === 'FT'
  );

  // Filter matches based on status filter
  const filteredByStatus = useMemo(() => {
    switch (statusFilter) {
      case 'live':
        return liveMatches;
      case 'upcoming':
        return upcomingMatches;
      case 'finished':
        return finishedMatches;
      default:
        return sortedMatches;
    }
  }, [sortedMatches, liveMatches, upcomingMatches, finishedMatches, statusFilter]);

  // Get unique leagues for filtering
  const uniqueLeagues = useMemo(() => {
    const leagues = new Map();
    sortedMatches.forEach(match => {
      if (match?.league?.id && match?.league?.name) {
        leagues.set(match.league.id, match.league.name);
      }
    });
    return Array.from(leagues, ([id, name]) => ({ id, name }));
  }, [sortedMatches]);

  // Filter by league and risk level
  const filteredMatches = useMemo(() => {
    let filtered = filteredByStatus;

    // Apply league filter
    if (leagueFilter !== 'all') {
      filtered = filtered.filter(m => m?.league?.id?.toString() === leagueFilter);
    }

    // Apply low risk filter (show only major leagues)
    if (lowRiskOnly) {
      const majorLeagueIds = [39, 140, 78, 135, 61, 2, 3, 203, 88, 94]; // Major leagues
      filtered = filtered.filter(m =>
        m?.league?.id && majorLeagueIds.includes(m.league.id)
      );
    }

    return filtered;
  }, [filteredByStatus, leagueFilter, lowRiskOnly]);

  // Paginate filtered matches
  const paginatedMatches = useMemo(() => {
    const startIdx = (currentPage - 1) * 20;
    const endIdx = startIdx + 20;
    return filteredMatches.slice(startIdx, endIdx);
  }, [filteredMatches, currentPage]);

  const totalPages = Math.ceil(filteredMatches.length / 20);

  const getStatsCards = () => (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <Card className="hover:shadow-md transition-shadow duration-200">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Toplam Maç</CardTitle>
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats?.totalMatches ?? matches?.length ?? 0}</div>
          <p className="text-xs text-muted-foreground">
            {showEndedMatches 
              ? `${endedMatchesHours}-${endedMatchesHours + 2} saat önce`
              : selectedDate === new Date().toISOString().split('T')[0] ? 'Bugün' : formatToStockholmDate(selectedDate)
            }
          </p>
        </CardContent>
      </Card>
      
      <Card className="hover:shadow-md transition-shadow duration-200">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Canlı Maçlar</CardTitle>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600">{stats?.liveMatches ?? liveMatches?.length ?? 0}</div>
          <p className="text-xs text-muted-foreground">Şu anda oynanıyor</p>
        </CardContent>
      </Card>
      
      <Card className="hover:shadow-md transition-shadow duration-200">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Yaklaşan</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600">{stats?.upcomingMatches ?? upcomingMatches?.length ?? 0}</div>
          <p className="text-xs text-muted-foreground">Başlamamış</p>
        </CardContent>
      </Card>
      
      <Card className="hover:shadow-md transition-shadow duration-200">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Tamamlanan</CardTitle>
          <Trophy className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">{stats?.finishedMatches ?? finishedMatches?.length ?? 0}</div>
          <p className="text-xs text-muted-foreground">Biten maçlar</p>
        </CardContent>
      </Card>
    </div>
  );

  const renderContent = () => (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Enhanced Header with Dark Mode Toggle */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Target className="w-8 h-8 text-primary" />
            <h1 className="text-3xl font-bold">Football Prediction System</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/prediction-history">
              <Button variant="outline" size="sm" className="flex items-center gap-2">
                <History className="w-4 h-4" />
                Tahmin Gecmisi
              </Button>
            </Link>
            <Link href="/system-coupons">
              <Button variant="outline" size="sm" className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Sistem Kupon
              </Button>
            </Link>
            <Link href="/statistics">
              <Button variant="outline" size="sm" className="flex items-center gap-2">
                <ChartBar className="w-4 h-4" />
                Istatistikler
              </Button>
            </Link>
            <ThemeToggle />
          </div>
        </div>
        <p className="text-muted-foreground">
          Gelişmiş maç analizi ve AI destekli tahminler - Stockholm saati ({formatToStockholmDateTime(new Date().toISOString())})
        </p>
        <div className="mt-4 flex items-center gap-3">
          <GoalAnalyzerPanel />
          <span className="text-xs text-muted-foreground">
            Poisson + Oran Konsensüsü + H2H + Value Bet algoritmaları ile gol-beklentili maçları tek tıkla bul
          </span>
        </div>
      </div>

      {/* Enhanced Controls */}
      <ClientWrapper>
        <div className="space-y-4 mb-6">
          {/* Primary controls row */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative">
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full sm:w-48 pr-10 form-input shadow-sm"
              />
              <Calendar className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>

            <div className="flex gap-2 flex-1">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Takım, lig veya ülke ara..."
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-10 form-input shadow-sm"
                />
              </div>
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              variant="outline"
              size="icon"
              className="shrink-0"
              title="Yenile"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-2">
            <Button
              onClick={() => setStatusFilter('all')}
              variant={statusFilter === 'all' ? 'default' : 'outline'}
              size="sm"
            >
              Tümü ({filteredMatches.length})
            </Button>
            <Button
              onClick={() => setStatusFilter('live')}
              variant={statusFilter === 'live' ? 'default' : 'outline'}
              size="sm"
              className={statusFilter === 'live' ? 'bg-red-600 hover:bg-red-700' : ''}
            >
              Canlı ({liveMatches.length})
            </Button>
            <Button
              onClick={() => setStatusFilter('upcoming')}
              variant={statusFilter === 'upcoming' ? 'default' : 'outline'}
              size="sm"
              className={statusFilter === 'upcoming' ? 'bg-blue-600 hover:bg-blue-700' : ''}
            >
              Yaklaşan ({upcomingMatches.length})
            </Button>
            <Button
              onClick={() => setStatusFilter('finished')}
              variant={statusFilter === 'finished' ? 'default' : 'outline'}
              size="sm"
              className={statusFilter === 'finished' ? 'bg-green-600 hover:bg-green-700' : ''}
            >
              Biten ({finishedMatches.length})
            </Button>
            <Button
              onClick={() => setLowRiskOnly(!lowRiskOnly)}
              variant={lowRiskOnly ? 'default' : 'outline'}
              size="sm"
              className={lowRiskOnly ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
              title="Sadece düşük riskli ve güvenilir tahminleri göster"
            >
              <Target className="w-4 h-4 mr-1" />
              Güvenilir Tahminler
            </Button>
          </div>

          {uniqueLeagues.length > 0 && (
            <select
              value={leagueFilter}
              onChange={(e) => {
                setLeagueFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="px-3 py-1.5 text-sm border rounded-md bg-background"
            >
              <option value="all">Tüm Ligler</option>
              {uniqueLeagues.map(league => (
                <option key={league.id} value={league.id}>{league.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Ended Matches Navigation */}
        <div className="flex items-center gap-2">
          <Button
            onClick={toggleEndedMatches}
            variant={showEndedMatches ? "default" : "outline"}
            size="sm"
            className="flex items-center gap-2"
          >
            <History className="w-4 h-4" />
            {showEndedMatches ? 'Biten Maçlar' : 'Biten Maçları Göster'}
          </Button>
          
          {showEndedMatches && (
            <div className="flex items-center gap-2 ml-2">
              <Button
                onClick={() => handleEndedMatchesNavigation('next')}
                disabled={endedMatchesHours === 0}
                variant="outline"
                size="sm"
              >
                <ChevronLeft className="w-4 h-4" />
                Daha Yakın
              </Button>
              <span className="text-sm text-muted-foreground px-2">
                {endedMatchesHours}-{endedMatchesHours + 2} saat önce
              </span>
              <Button
                onClick={() => handleEndedMatchesNavigation('prev')}
                variant="outline"
                size="sm"
              >
                Daha Uzak
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </ClientWrapper>

    {/* Enhanced Stats Cards */}
    {getStatsCards()}

      {/* Main Content with Enhanced Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="matches">
            <CalendarDays className="w-4 h-4 mr-2" />
            Maçlar ({stats?.totalMatches ?? 0})
          </TabsTrigger>
          <TabsTrigger value="live">
            <Activity className="w-4 h-4 mr-2" />
            Canlı ({stats?.liveMatches ?? 0})
          </TabsTrigger>
          <TabsTrigger value="upcoming">
            <TrendingUp className="w-4 h-4 mr-2" />
            Tahminler ({stats?.upcomingMatches ?? 0})
          </TabsTrigger>
          <TabsTrigger value="bulk-analysis">
            <ChartBar className="w-4 h-4 mr-2" />
            Toplu Analiz
          </TabsTrigger>
          <TabsTrigger value="goal-insights">
            <Target className="w-4 h-4 mr-2" />
            KG & Üst 2.5
          </TabsTrigger>
        </TabsList>

        {/* Enhanced All Matches Tab */}
        <TabsContent value="matches" className="space-y-6">
          {loading ? (
            <div className="text-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
              <div className="text-lg font-medium">Maçlar yükleniyor...</div>
              <div className="text-sm text-muted-foreground mt-1">
                Enhanced API ile sıralama ve filtreleme uygulanıyor...
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <div className="text-red-600 text-lg font-medium mb-2">Maçlar yüklenemedi</div>
              <div className="text-sm text-muted-foreground mb-6">{error}</div>
              <Button onClick={handleRefresh} size="lg">
                <RefreshCw className="w-4 h-4 mr-2" />
                Tekrar Dene
              </Button>
            </div>
          ) : matches?.length === 0 ? (
            <div className="text-center py-12">
              <CalendarDays className="w-16 h-16 mx-auto mb-6 text-muted-foreground" />
              <div className="text-xl font-medium mb-3">Maç bulunamadı</div>
              <div className="text-muted-foreground mb-6">
                {searchTerm ? 'Arama kriterlerinize uygun' : showEndedMatches ? 'Bu zaman aralığında biten' : 'Seçilen tarih için'} maç bulunamadı.
              </div>
              <div className="flex gap-2 justify-center">
                {searchTerm && (
                  <Button onClick={() => handleSearchChange('')} variant="outline">
                    Aramayı Temizle
                  </Button>
                )}
                {showEndedMatches && (
                  <Button onClick={toggleEndedMatches} variant="outline">
                    Biten Maç Modunu Kapat
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Enhanced Match List - Chronological Order (Live First) */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold flex items-center gap-3">
                    <Filter className="w-6 h-6 text-primary" />
                    {showEndedMatches ? 'Biten Maçlar' : 'Tüm Maçlar'}
                    {searchTerm && (
                      <Badge variant="secondary" className="ml-2">
                        "{searchTerm}" için sonuçlar
                      </Badge>
                    )}
                  </h3>
                  <div className="text-sm text-muted-foreground">
                    Sayfa {currentPage} / {totalPages} ({filteredMatches.length} maç)
                  </div>
                </div>
                
                {/* Responsive grid with chronological sorting - Using paginated matches */}
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                 {paginatedMatches?.map((match) => (
                    <PredictionModal key={match?.fixture?.id} match={match}>
                      <div className="cursor-pointer h-full">
                        <MatchCard
                          match={match}
                          onViewPrediction={(matchId) => {}}
                          showPrediction={true}
                          onNavigateToPage={(matchId) => router.push(`/predictions/${matchId}`)}
                          predictionOutcomes={predictionOutcomes[match?.fixture?.id]}
                        />
                      </div>
                    </PredictionModal>
                  )) ?? []}
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex justify-center mt-6">
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => {
                          setCurrentPage(Math.max(1, currentPage - 1));
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        disabled={currentPage === 1}
                        variant="outline"
                        size="sm"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        Önceki
                      </Button>

                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                          let pageNum;
                          if (totalPages <= 5) {
                            pageNum = i + 1;
                          } else if (currentPage <= 3) {
                            pageNum = i + 1;
                          } else if (currentPage >= totalPages - 2) {
                            pageNum = totalPages - 4 + i;
                          } else {
                            pageNum = currentPage - 2 + i;
                          }

                          return (
                            <Button
                              key={pageNum}
                              onClick={() => {
                                setCurrentPage(pageNum);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              variant={currentPage === pageNum ? 'default' : 'outline'}
                              size="sm"
                              className="w-10"
                            >
                              {pageNum}
                            </Button>
                          );
                        })}
                      </div>

                      <Button
                        onClick={() => {
                          setCurrentPage(Math.min(totalPages, currentPage + 1));
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        disabled={currentPage === totalPages}
                        variant="outline"
                        size="sm"
                      >
                        Sonraki
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Enhanced Live Matches Tab */}
        <TabsContent value="live" className="space-y-4">
          {(stats?.liveMatches ?? 0) === 0 ? (
            <div className="text-center py-12">
              <Activity className="w-16 h-16 mx-auto mb-6 text-muted-foreground" />
              <div className="text-xl font-medium mb-3">Şu anda canlı maç yok</div>
              <div className="text-muted-foreground">
                Canlı maçlar otomatik olarak bu bölümde görüntülenir
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold flex items-center gap-3">
                  <Activity className="w-6 h-6 text-red-600" />
                  Canlı Maçlar
                </h3>
                <Badge variant="destructive" className="animate-pulse">
                  {stats?.liveMatches ?? 0} canlı
                </Badge>
              </div>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {liveMatches?.map((match) => (
                  <PredictionModal key={match?.fixture?.id} match={match}>
                    <div className="cursor-pointer h-full">
                      <MatchCard
                        match={match}
                        onViewPrediction={(matchId) => {}}
                        showPrediction={true}
                        onNavigateToPage={(matchId) => router.push(`/predictions/${matchId}`)}
                      />
                    </div>
                  </PredictionModal>
                )) ?? []}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Enhanced Predictions Tab with High Confidence Indicators */}
        <TabsContent value="upcoming" className="space-y-4">
          {loading ? (
            <div className="text-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
              <div className="text-lg font-medium">Tahminler yükleniyor...</div>
              <div className="text-sm text-muted-foreground mt-1">
                Yaklaşan maçlar için model verileri hazırlanıyor
              </div>
            </div>
          ) : upcomingMatches.length === 0 ? (
            <div className="text-center py-12">
              <TrendingUp className="w-16 h-16 mx-auto mb-6 text-muted-foreground" />
              <div className="text-xl font-medium mb-3">Tahmin edilecek maç yok</div>
              <div className="text-muted-foreground">
                Yaklaşan maçlar için AI tahminleri burada görüntülenir
              </div>
            </div>
          ) : (
            <OptimizedMatchListEnhanced
              matches={upcomingMatches}
              loading={loading}
              error={error}
              onRetry={handleRefresh}
              searchPlaceholder="Yaklaşan maçlarda ara..."
              showPagination={true}
              pageSize={20}
              showHighConfidenceOnly={false}
            />
          )}
        </TabsContent>

        {/* Bulk Analysis Tab */}
        <TabsContent value="bulk-analysis" className="space-y-6">
          <div className="text-center py-8">
            <ChartBar className="w-16 h-16 mx-auto mb-6 text-primary" />
            <div className="text-xl font-medium mb-3">Toplu Maç Analizi</div>
            <div className="text-muted-foreground mb-6">
              Günün tüm maçları için kapsamlı analiz yapmak için aşağıdaki linke tıklayın
            </div>
            <div className="flex gap-4 justify-center">
              <Link href="/bulk-analysis">
                <Button size="lg" className="bg-primary hover:bg-primary/90">
                  <ChartBar className="w-4 h-4 mr-2" />
                  Analiz Sayfasına Git
                </Button>
              </Link>
              <Link href="/settings">
                <Button size="lg" variant="outline">
                  <Settings className="w-4 h-4 mr-2" />
                  Ayarlar
                </Button>
              </Link>
            </div>
          </div>
        </TabsContent>

        {/* Goals & KG High Confidence Tab */}
        <TabsContent value="goal-insights" className="space-y-4">
          <HighConfidenceGoalsTable />
        </TabsContent>
      </Tabs>
    </div>
  );

  return renderContent();
}
