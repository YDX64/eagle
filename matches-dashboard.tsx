
'use client';

import { useState, useEffect, useMemo } from 'react';
import { MatchCard } from './match-card';
import { MatchCardEnhanced } from './match-card-enhanced';
import { PredictionModal } from './prediction-modal';
import { LeagueStandings } from './league-standings';
import { OptimizedMatchListEnhanced } from './optimized-match-list-enhanced';
import { ThemeToggle } from './theme-toggle';
import { Pagination } from './pagination';
import { ClientWrapper } from './client-wrapper';
import { ProBetTab } from './probet-tab';
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
  ChartBar,
  Brain
} from 'lucide-react';
import Link from 'next/link';
import { Fixture, MAJOR_LEAGUES } from '@/lib/api-football';
import { 
  formatToStockholmTime, 
  formatToStockholmDate, 
  formatToStockholmDateTime,
  PaginationResult
} from '@/lib/utils';

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
  
  // Ended matches functionality
  const [endedMatchesHours, setEndedMatchesHours] = useState(0);
  const [showEndedMatches, setShowEndedMatches] = useState(false);

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
        limit: '100', // Increased for better performance
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

  // Filter by league
  const filteredMatches = useMemo(() => {
    if (leagueFilter === 'all') {
      return filteredByStatus;
    }
    return filteredByStatus.filter(m => m?.league?.id?.toString() === leagueFilter);
  }, [filteredByStatus, leagueFilter]);

  // Paginate filtered matches
  const paginatedMatches = useMemo(() => {
    const startIdx = (currentPage - 1) * 20;
    const endIdx = startIdx + 20;
    return filteredMatches.slice(startIdx, endIdx);
  }, [filteredMatches, currentPage]);

  const totalPages = Math.ceil(filteredMatches.length / 20);

  const getStatsCards = () => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {/* Toplam Maç — violet gradient */}
      <Card className="border-2 border-violet-200/50 dark:border-violet-800/40 bg-gradient-to-br from-violet-50/60 to-white dark:from-violet-950/30 dark:to-slate-900 hover:shadow-lg hover:shadow-violet-200/40 dark:hover:shadow-violet-500/10 transition-all duration-200">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Toplam Maç</CardTitle>
          <div className="p-1.5 rounded-md bg-gradient-to-br from-violet-500 to-blue-600">
            <CalendarDays className="h-3.5 w-3.5 text-white" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-blue-700 dark:from-violet-400 dark:to-blue-400 bg-clip-text text-transparent">
            {stats?.totalMatches ?? matches?.length ?? 0}
          </div>
          <p className="text-xs text-muted-foreground">
            {showEndedMatches
              ? `${endedMatchesHours}-${endedMatchesHours + 2} saat önce`
              : selectedDate === new Date().toISOString().split('T')[0] ? 'Bugün' : formatToStockholmDate(selectedDate)
            }
          </p>
        </CardContent>
      </Card>

      {/* Canlı Maçlar — red pulse */}
      <Card className="border-2 border-rose-200/50 dark:border-rose-800/40 bg-gradient-to-br from-rose-50/60 to-white dark:from-rose-950/30 dark:to-slate-900 hover:shadow-lg hover:shadow-rose-200/40 dark:hover:shadow-rose-500/10 transition-all duration-200">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Canlı Maçlar</CardTitle>
          <div className="p-1.5 rounded-md bg-gradient-to-br from-rose-500 to-red-600 animate-pulse">
            <Activity className="h-3.5 w-3.5 text-white" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">{stats?.liveMatches ?? liveMatches?.length ?? 0}</div>
          <p className="text-xs text-muted-foreground">Şu anda oynanıyor</p>
        </CardContent>
      </Card>

      {/* Yaklaşan — blue */}
      <Card className="border-2 border-blue-200/50 dark:border-blue-800/40 bg-gradient-to-br from-blue-50/60 to-white dark:from-blue-950/30 dark:to-slate-900 hover:shadow-lg hover:shadow-blue-200/40 dark:hover:shadow-blue-500/10 transition-all duration-200">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Yaklaşan</CardTitle>
          <div className="p-1.5 rounded-md bg-gradient-to-br from-blue-500 to-cyan-600">
            <Clock className="h-3.5 w-3.5 text-white" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats?.upcomingMatches ?? upcomingMatches?.length ?? 0}</div>
          <p className="text-xs text-muted-foreground">Başlamamış</p>
        </CardContent>
      </Card>

      {/* Tamamlanan — emerald */}
      <Card className="border-2 border-emerald-200/50 dark:border-emerald-800/40 bg-gradient-to-br from-emerald-50/60 to-white dark:from-emerald-950/30 dark:to-slate-900 hover:shadow-lg hover:shadow-emerald-200/40 dark:hover:shadow-emerald-500/10 transition-all duration-200">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Tamamlanan</CardTitle>
          <div className="p-1.5 rounded-md bg-gradient-to-br from-emerald-500 to-teal-600">
            <Trophy className="h-3.5 w-3.5 text-white" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats?.finishedMatches ?? finishedMatches?.length ?? 0}</div>
          <p className="text-xs text-muted-foreground">Biten maçlar</p>
        </CardContent>
      </Card>
    </div>
  );

  const renderContent = () => (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* ProBet-style brand header */}
      <div className="mb-8 rounded-lg border-2 border-primary/20 bg-gradient-to-br from-violet-50 via-blue-50 to-emerald-50 dark:from-violet-950/40 dark:via-blue-950/40 dark:to-emerald-950/40 p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 shadow-lg shadow-violet-500/20">
                <Target className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-violet-600 to-blue-700 dark:from-violet-400 dark:to-blue-400 bg-clip-text text-transparent">
                  Football Prediction System
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Poisson + xG · Gradient Boost Ensemble · Tüm major ligler
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Gelişmiş maç analizi ve AI destekli tahminler — Stockholm saati{' '}
              <span className="font-mono">{formatToStockholmDateTime(new Date().toISOString())}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/statistics">
              <Button
                variant="outline"
                size="sm"
                className="flex items-center gap-2 border-violet-300/50 hover:border-violet-500 hover:bg-violet-50 dark:hover:bg-violet-950/40"
              >
                <ChartBar className="w-4 h-4" />
                İstatistikler
              </Button>
            </Link>
            <ThemeToggle />
          </div>
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
        <TabsList className="grid w-full grid-cols-6">
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
          <TabsTrigger
            value="probet"
            className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-500 data-[state=active]:to-blue-600 data-[state=active]:text-white"
          >
            <Brain className="w-4 h-4 mr-2" />
            ProBet
          </TabsTrigger>
          <TabsTrigger value="bulk-analysis">
            <ChartBar className="w-4 h-4 mr-2" />
            Toplu Analiz
          </TabsTrigger>
          <TabsTrigger value="standings">
            <Trophy className="w-4 h-4 mr-2" />
            Sıralamar
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
          {(stats?.upcomingMatches ?? 0) === 0 ? (
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

        {/* ProBet Tab — ProphitBet-style ML predictions */}
        <TabsContent value="probet" className="space-y-4">
          <ProBetTab />
        </TabsContent>

        {/* Bulk Analysis Tab */}
        <TabsContent value="bulk-analysis" className="space-y-6">
          <div className="text-center py-8">
            <ChartBar className="w-16 h-16 mx-auto mb-6 text-primary" />
            <div className="text-xl font-medium mb-3">Toplu Maç Analizi</div>
            <div className="text-muted-foreground mb-6">
              Günün tüm maçları için kapsamlı analiz yapmak için aşağıdaki linke tıklayın
            </div>
            <Link href="/bulk-analysis">
              <Button size="lg" className="bg-primary hover:bg-primary/90">
                <ChartBar className="w-4 h-4 mr-2" />
                Analiz Sayfasına Git
              </Button>
            </Link>
          </div>
        </TabsContent>

        {/* Standings Tab (Unchanged) */}
        <TabsContent value="standings" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <LeagueStandings
              leagueId={MAJOR_LEAGUES.PREMIER_LEAGUE}
              leagueName="Premier League"
            />
            <LeagueStandings
              leagueId={MAJOR_LEAGUES.LA_LIGA}
              leagueName="La Liga"
            />
            <LeagueStandings
              leagueId={MAJOR_LEAGUES.BUNDESLIGA}
              leagueName="Bundesliga"
            />
            <LeagueStandings
              leagueId={MAJOR_LEAGUES.SERIE_A}
              leagueName="Serie A"
            />
            <LeagueStandings
              leagueId={MAJOR_LEAGUES.LIGUE_1}
              leagueName="Ligue 1"
            />
            <LeagueStandings
              leagueId={MAJOR_LEAGUES.SUPER_LIG}
              leagueName="Süper Lig"
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );

  return renderContent();
}
