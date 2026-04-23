
'use client';

import React, { memo, useMemo, useState, useCallback } from 'react';
import { MatchCard } from './match-card';
import { LoadingCard } from './loading-spinner';
import { ApiErrorFallback } from './api-error-fallback';
import { useMatchFilters, usePaginatedData, useDebounce } from '@/lib/performance';
import { Fixture } from '@/lib/api-football';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';

interface OptimizedMatchListProps {
  matches: Fixture[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  searchPlaceholder?: string;
  showPagination?: boolean;
  pageSize?: number;
}

// Memoized match card to prevent unnecessary re-renders
const MemoizedMatchCard = memo(MatchCard);

export const OptimizedMatchList: React.FC<OptimizedMatchListProps> = memo(({
  matches,
  loading = false,
  error,
  onRetry,
  searchPlaceholder = 'Search matches...',
  showPagination = true,
  pageSize = 25,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMatch, setSelectedMatch] = useState<Fixture | null>(null);

  // Debounced search to improve performance
  const debouncedSearch = useDebounce((term: string) => {
    setSearchTerm(term);
    setCurrentPage(1); // Reset to first page on search
  }, 300);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    debouncedSearch(e.target.value);
  }, [debouncedSearch]);

  // Filter matches based on search term
  const filteredMatches = useMatchFilters(matches, searchTerm, {});

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
      {searchTerm && (
        <div className="text-sm text-muted-foreground">
          Found {totalItems} match{totalItems !== 1 ? 'es' : ''} for "{searchTerm}"
        </div>
      )}

      {/* Match List */}
      <div id="match-list-top" className="space-y-4">
        {currentPageMatches.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              No matches found {searchTerm ? `for "${searchTerm}"` : ''}
            </p>
          </div>
        ) : (
          currentPageMatches.map((match) => (
            <MemoizedMatchCard
              key={`${match.fixture.id}-${match.fixture.date}`}
              match={match}
              onViewPrediction={() => setSelectedMatch(match)}
            />
          ))
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

OptimizedMatchList.displayName = 'OptimizedMatchList';
