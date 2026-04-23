'use client';

import React, { memo, useMemo, useState, useCallback, useEffect } from 'react';
import { MatchCardEnhanced } from './match-card-enhanced';
import { LoadingCard } from './loading-spinner';
import { ApiErrorFallback } from './api-error-fallback';
import { useMatchFilters, usePaginatedData, useDebounce } from '@/lib/performance';
import { usePredictionCache } from '@/lib/hooks/usePredictionCache';
import { Fixture } from '@/lib/api-football';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, ChevronLeft, ChevronRight, Sparkles, TrendingUp, AlertCircle } from 'lucide-react';

interface OptimizedMatchListEnhancedProps {
  matches: Fixture[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  searchPlaceholder?: string;
  showPagination?: boolean;
  pageSize?: number;
  showHighConfidenceOnly?: boolean;
}

// Memoized match card to prevent unnecessary re-renders
const MemoizedMatchCard = memo(MatchCardEnhanced);

export const OptimizedMatchListEnhanced: React.FC<OptimizedMatchListEnhancedProps> = memo(({
  matches,
  loading = false,
  error,
  onRetry,
  searchPlaceholder = 'Search matches...',
  showPagination = true,
  pageSize = 25,
  showHighConfidenceOnly = false,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMatch, setSelectedMatch] = useState<Fixture | null>(null);
  const [filterHighConfidence, setFilterHighConfidence] = useState(showHighConfidenceOnly);

  // Get upcoming match IDs for prediction fetching
  const upcomingMatchIds = useMemo(() => {
    return matches
      .filter(m => m.fixture.status.short === 'NS')
      .map(m => m.fixture.id);
  }, [matches]);

  // Fetch predictions with auto-refresh every 5 minutes
  const {
    predictions,
    loading: predictionsLoading,
    getHighConfidencePredictions,
    getPrediction,
    refreshPrediction
  } = usePredictionCache({
    matchIds: upcomingMatchIds,
    autoRefresh: true,
    refreshInterval: 300000 // 5 minutes
  });

  // Get high confidence predictions
  const highConfidencePredictions = useMemo(() => {
    return getHighConfidencePredictions(75);
  }, [predictions, getHighConfidencePredictions]);

  // Debounced search to improve performance
  const debouncedSearch = useDebounce((term: string) => {
    setSearchTerm(term);
    setCurrentPage(1); // Reset to first page on search
  }, 300);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    debouncedSearch(e.target.value);
  }, [debouncedSearch]);

  // Filter matches based on search term and confidence filter
  const filteredMatches = useMemo(() => {
    let result = useMatchFilters(matches, searchTerm, {});

    // Apply high confidence filter if enabled
    if (filterHighConfidence) {
      const highConfidenceMatchIds = new Set(
        highConfidencePredictions.map(p => p.match_id)
      );
      result = result.filter(m =>
        m.fixture.status.short !== 'NS' || highConfidenceMatchIds.has(m.fixture.id)
      );
    }

    return result;
  }, [matches, searchTerm, filterHighConfidence, highConfidencePredictions]);

  // Paginate the filtered matches
  const { totalPages, totalItems, getPageData, hasNextPage, hasPrevPage } = usePaginatedData(
    filteredMatches,
    pageSize
  );

  const currentPageMatches = useMemo(() =>
    getPageData(currentPage),
    [getPageData, currentPage]
  );

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    // Smooth scroll to top of match list
    setTimeout(() => {
      const element = document.getElementById('match-list-top');
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }, []);

  const handleViewPrediction = useCallback((matchId: number) => {
    const match = matches.find(m => m.fixture.id === matchId);
    if (match) {
      setSelectedMatch(match);
      // Refresh prediction for this specific match
      refreshPrediction(matchId);
    }
  }, [matches, refreshPrediction]);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <LoadingCard key={i} title="Loading matches..." />
        ))}
      </div>
    );
  }

  if (error) {
    return <ApiErrorFallback error={error} onRetry={onRetry} />;
  }

  if (!matches?.length) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No matches available</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30 rounded-lg p-4 border border-emerald-200 dark:border-emerald-800">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                Yüksek Güvenli Tahminler
              </h3>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                {highConfidencePredictions.length} maç için güvenli tahmin mevcut
              </p>
            </div>
          </div>
          <Button
            variant={filterHighConfidence ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterHighConfidence(!filterHighConfidence)}
            className="gap-2"
          >
            <TrendingUp className="w-4 h-4" />
            {filterHighConfidence ? 'Tüm Maçlar' : 'Sadece Güvenli'}
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input
          placeholder={searchPlaceholder}
          onChange={handleSearchChange}
          className="pl-10"
          type="search"
        />
      </div>

      {/* Results Info */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {searchTerm && `Found ${totalItems} match${totalItems !== 1 ? 'es' : ''} for "${searchTerm}"`}
          {!searchTerm && `${totalItems} maç gösteriliyor`}
        </div>
        {predictionsLoading && (
          <Badge variant="secondary" className="animate-pulse">
            <div className="w-2 h-2 bg-primary rounded-full mr-2 animate-pulse" />
            Tahminler güncelleniyor...
          </Badge>
        )}
      </div>

      {/* High Confidence Alert */}
      {highConfidencePredictions.length > 0 && !filterHighConfidence && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                {highConfidencePredictions.length} Yüksek Güvenli Tahmin Bulundu!
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                En güvenli bahis önerileri için bu maçları inceleyin. Saatlik olarak güncellenmektedir.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Match List */}
      <div id="match-list-top" className="space-y-4">
        {currentPageMatches.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {filterHighConfidence
                ? 'Yüksek güvenli tahmin bulunamadı. Daha sonra tekrar kontrol edin.'
                : searchTerm
                  ? `No matches found for "${searchTerm}"`
                  : 'No matches found'}
            </p>
          </div>
        ) : (
          currentPageMatches.map((match) => {
            const predictionData = match.fixture.status.short === 'NS'
              ? getPrediction(match.fixture.id)
              : undefined;

            return (
              <MemoizedMatchCard
                key={`${match.fixture.id}-${match.fixture.date}`}
                match={match}
                onViewPrediction={handleViewPrediction}
                predictionData={predictionData}
              />
            );
          })
        )}
      </div>

      {/* Pagination */}
      {showPagination && totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 bg-muted/30 rounded-lg">
          <div className="text-sm text-muted-foreground">
            Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, totalItems)} of {totalItems}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={!hasPrevPage(currentPage)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium px-2">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={!hasNextPage(currentPage)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});

OptimizedMatchListEnhanced.displayName = 'OptimizedMatchListEnhanced';