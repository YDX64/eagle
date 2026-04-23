'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { PredictionModal } from './prediction-modal';
import { LeagueStandings } from './league-standings';
import { OptimizedMatchListEnhanced } from './optimized-match-list-enhanced';
import { GoalAnalyzerPanel } from './goal-analyzer-panel';
import { ThemeToggle } from './theme-toggle';
import { ClientWrapper } from './client-wrapper';
import { ProBetTab } from './probet-tab';
import {
  CalendarDays,
  Activity,
  Trophy,
  Search,
  RefreshCw,
  TrendingUp,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChartBar,
  Brain,
  History,
  Filter,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { Fixture, MAJOR_LEAGUES } from '@/lib/api-football';
import {
  formatToStockholmTime,
  formatToStockholmDate,
  formatToStockholmDateTime,
  PaginationResult,
} from '@/lib/utils';

/* ─── Types ───────────────────────────────────── */

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

type StatusFilter = 'all' | 'live' | 'upcoming' | 'finished';
type GoalFilter = 'all' | '0-1' | '2-3' | '4-5' | '6+';

/* ─── Helpers ─────────────────────────────────── */

const LIVE_CODES = new Set(['1H', '2H', 'HT', 'ET', 'P', 'BT', 'LIVE']);
const FINISHED_CODES = new Set(['FT', 'AET', 'PEN']);
const ITEMS_PER_PAGE = 100;

function isLive(status: string) {
  return LIVE_CODES.has(status);
}
function isFinished(status: string) {
  return FINISHED_CODES.has(status);
}
function isUpcoming(status: string) {
  return status === 'NS' || status === 'TBD' || status === 'PST';
}

function getMatchTime(match: Fixture): string {
  try {
    const d = new Date(match.fixture.date);
    return d.toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Stockholm',
    });
  } catch {
    return '--:--';
  }
}

function totalGoals(match: Fixture): number {
  return (match.goals?.home ?? 0) + (match.goals?.away ?? 0);
}

function isBTTS(match: Fixture): boolean {
  return (match.goals?.home ?? 0) > 0 && (match.goals?.away ?? 0) > 0;
}

function matchesGoalFilter(match: Fixture, filter: GoalFilter): boolean {
  if (filter === 'all') return true;
  const t = totalGoals(match);
  switch (filter) {
    case '0-1': return t <= 1;
    case '2-3': return t >= 2 && t <= 3;
    case '4-5': return t >= 4 && t <= 5;
    case '6+': return t >= 6;
    default: return true;
  }
}

/* ─── Status Badge ────────────────────────────── */

function StatusBadge({ status }: { status: { short: string; elapsed: number; long: string } }) {
  const code = status.short;

  if (isLive(code)) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500 text-white animate-pulse">
        <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
        {status.elapsed ? `${status.elapsed}'` : code}
      </span>
    );
  }

  if (code === 'HT') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500 text-white">
        DS
      </span>
    );
  }

  if (isFinished(code)) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400">
        {code === 'AET' ? 'UZ' : code === 'PEN' ? 'PEN' : 'MS'}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
      {code === 'NS' ? 'BS' : code}
    </span>
  );
}

/* ─── League Header Row ───────────────────────── */

function LeagueHeader({ name, country, logo, count }: { name: string; country: string; logo?: string; count: number }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-1.5 bg-slate-100/95 dark:bg-slate-800/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700">
      {logo && (
        <img src={logo} alt="" className="w-4 h-4 object-contain" loading="lazy" />
      )}
      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
        {country && <span className="text-slate-400 dark:text-slate-500 mr-1">{country} ·</span>}
        {name}
      </span>
      <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto">{count}</span>
    </div>
  );
}

/* ─── Match Row ───────────────────────────────── */

function MatchRow({ match }: { match: Fixture }) {
  const status = match.fixture?.status?.short ?? 'NS';
  const live = isLive(status) || status === 'HT';
  const finished = isFinished(status);
  const homeGoals = match.goals?.home;
  const awayGoals = match.goals?.away;
  const hasScore = homeGoals !== null && awayGoals !== null;

  return (
    <PredictionModal match={match}>
      <div
        className={`
          flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5 border-b border-slate-100 dark:border-slate-700/50
          hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-sm cursor-pointer select-none
          ${live ? 'bg-red-50/50 dark:bg-red-950/20 border-l-2 border-l-red-500' : ''}
          ${finished ? 'text-slate-500 dark:text-slate-500' : ''}
        `}
      >
        {/* Time */}
        <span className="w-10 sm:w-12 text-[11px] sm:text-xs font-mono text-muted-foreground shrink-0 text-center">
          {live && match.fixture?.status?.elapsed
            ? <span className="text-red-500 font-bold">{match.fixture.status.elapsed}&apos;</span>
            : getMatchTime(match)
          }
        </span>

        {/* League - hidden on mobile */}
        <span className="hidden md:block w-32 text-[11px] text-muted-foreground truncate shrink-0" title={match.league?.name}>
          {match.league?.name}
        </span>

        {/* Home team */}
        <span className={`flex-1 text-right text-xs sm:text-sm truncate ${finished ? '' : 'font-medium'} ${live ? 'text-slate-900 dark:text-white' : ''}`}>
          {match.teams?.home?.name}
        </span>

        {/* Score */}
        <span className={`w-12 sm:w-16 text-center font-bold font-mono text-sm sm:text-base shrink-0 ${live ? 'text-red-600 dark:text-red-400' : finished ? 'text-slate-600 dark:text-slate-400' : 'text-slate-400 dark:text-slate-600'}`}>
          {hasScore ? `${homeGoals} - ${awayGoals}` : 'vs'}
        </span>

        {/* Away team */}
        <span className={`flex-1 text-xs sm:text-sm truncate ${finished ? '' : 'font-medium'} ${live ? 'text-slate-900 dark:text-white' : ''}`}>
          {match.teams?.away?.name}
        </span>

        {/* Status badge */}
        <span className="w-14 sm:w-20 shrink-0 flex justify-center">
          <StatusBadge status={match.fixture?.status ?? { short: 'NS', elapsed: 0, long: '' }} />
        </span>

        {/* Action link */}
        <span className="shrink-0 text-[11px] sm:text-xs text-primary hover:underline hidden sm:block">
          Tahmin →
        </span>
      </div>
    </PredictionModal>
  );
}

/* ═══════════════════════════════════════════════
   MAIN DASHBOARD
   ═══════════════════════════════════════════════ */

export function MatchesDashboard() {
  /* ── Core state ─────────────────────────────── */
  const [matches, setMatches] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('matches');

  /* ── Filtering & pagination state ───────────── */
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<ApiPagination | null>(null);
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [leagueFilter, setLeagueFilter] = useState<string>('all');
  const [goalFilter, setGoalFilter] = useState<GoalFilter>('all');
  const [kgFilter, setKgFilter] = useState(false);

  /* ── Ended matches ──────────────────────────── */
  const [endedMatchesHours, setEndedMatchesHours] = useState(0);
  const [showEndedMatches, setShowEndedMatches] = useState(false);

  /* ── Refs ────────────────────────────────────── */
  const listTopRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /* ── Data Fetching ──────────────────────────── */
  const fetchMatches = useCallback(async (
    date: string,
    page = 1,
    search = '',
    endedHours = 0,
  ) => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        date,
        page: page.toString(),
        limit: String(ITEMS_PER_PAGE),
        search,
        endedMatchesHours: endedHours.toString(),
        status: statusFilter,
      });

      const response = await fetch(`/api/matches/today?${params}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        setMatches(data.data?.matches || []);
        setPagination(data.data?.pagination || data.pagination);
        setStats(data.data?.stats || data.stats);
      } else {
        setError(data.error || 'Maclar yuklenemedi');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ag hatasi olustu');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMatches(selectedDate, currentPage, searchTerm, endedMatchesHours);
    setRefreshing(false);
  }, [fetchMatches, selectedDate, currentPage, searchTerm, endedMatchesHours]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    fetchMatches(selectedDate, page, searchTerm, endedMatchesHours);
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [fetchMatches, selectedDate, searchTerm, endedMatchesHours]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setCurrentPage(1);
      fetchMatches(selectedDate, 1, value, endedMatchesHours);
    }, 400);
  }, [fetchMatches, selectedDate, endedMatchesHours]);

  const handleDateChange = useCallback((date: string) => {
    setSelectedDate(date);
    setCurrentPage(1);
    setEndedMatchesHours(0);
    setShowEndedMatches(false);
    fetchMatches(date, 1, searchTerm, 0);
  }, [fetchMatches, searchTerm]);

  const handleEndedMatchesNavigation = useCallback((direction: 'prev' | 'next') => {
    const newHours = direction === 'next'
      ? Math.max(0, endedMatchesHours - 2)
      : endedMatchesHours + 2;
    setEndedMatchesHours(newHours);
    setCurrentPage(1);
    fetchMatches(selectedDate, 1, searchTerm, newHours);
  }, [fetchMatches, selectedDate, searchTerm, endedMatchesHours]);

  const toggleEndedMatches = useCallback(() => {
    const next = !showEndedMatches;
    setShowEndedMatches(next);
    const hours = next ? 2 : 0;
    setEndedMatchesHours(hours);
    setCurrentPage(1);
    fetchMatches(selectedDate, 1, searchTerm, hours);
  }, [fetchMatches, selectedDate, searchTerm, showEndedMatches]);

  /* ── Initial load ───────────────────────────── */
  useEffect(() => {
    fetchMatches(selectedDate, currentPage, searchTerm, endedMatchesHours);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Auto-refresh live matches every 30s ────── */
  useEffect(() => {
    if ((stats?.liveMatches ?? 0) > 0 && !showEndedMatches) {
      const interval = setInterval(() => {
        fetchMatches(selectedDate, currentPage, searchTerm, endedMatchesHours);
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [stats?.liveMatches, selectedDate, currentPage, searchTerm, endedMatchesHours, showEndedMatches, fetchMatches]);

  /* ── Derived data ───────────────────────────── */
  const safeMatches = Array.isArray(matches) ? matches : [];

  const sortedMatches = useMemo(() =>
    [...safeMatches].sort((a, b) => (a?.fixture?.timestamp ?? 0) - (b?.fixture?.timestamp ?? 0)),
    [safeMatches],
  );

  // Client-side categorizations (for local filtering within the 100-item page)
  const localLive = useMemo(() => sortedMatches.filter(m => isLive(m?.fixture?.status?.short ?? '') || m?.fixture?.status?.short === 'HT'), [sortedMatches]);
  const localUpcoming = useMemo(() => sortedMatches.filter(m => isUpcoming(m?.fixture?.status?.short ?? '')), [sortedMatches]);
  const localFinished = useMemo(() => sortedMatches.filter(m => isFinished(m?.fixture?.status?.short ?? '')), [sortedMatches]);

  // Status filter (client-side within page)
  // Status filtering is now server-side (API param).
  // afterStatusFilter just passes through sortedMatches.
  const afterStatusFilter = sortedMatches;

  // Unique leagues for dropdown
  const uniqueLeagues = useMemo(() => {
    const map = new Map<string, { id: string; name: string; country: string }>();
    sortedMatches.forEach(m => {
      const lid = m?.league?.id?.toString();
      if (lid && m?.league?.name) {
        map.set(lid, { id: lid, name: m.league.name, country: m.league.country ?? '' });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [sortedMatches]);

  // Apply all client-side filters
  const filteredMatches = useMemo(() => {
    let result = afterStatusFilter;

    // League filter
    if (leagueFilter !== 'all') {
      result = result.filter(m => m?.league?.id?.toString() === leagueFilter);
    }

    // KG filter
    if (kgFilter) {
      result = result.filter(m => isBTTS(m));
    }

    // Goal filter
    if (goalFilter !== 'all') {
      result = result.filter(m => matchesGoalFilter(m, goalFilter));
    }

    return result;
  }, [afterStatusFilter, leagueFilter, kgFilter, goalFilter]);

  // Group by league
  const groupedByLeague = useMemo(() => {
    const groups: { leagueId: string; leagueName: string; leagueCountry: string; leagueLogo: string; matches: Fixture[] }[] = [];
    const map = new Map<string, typeof groups[0]>();

    filteredMatches.forEach(m => {
      const lid = m?.league?.id?.toString() ?? 'unknown';
      if (!map.has(lid)) {
        const entry = {
          leagueId: lid,
          leagueName: m?.league?.name ?? 'Bilinmeyen Lig',
          leagueCountry: m?.league?.country ?? '',
          leagueLogo: m?.league?.logo ?? '',
          matches: [] as Fixture[],
        };
        map.set(lid, entry);
        groups.push(entry);
      }
      map.get(lid)!.matches.push(m);
    });

    return groups;
  }, [filteredMatches]);

  // API-level pagination info
  const apiTotalPages = pagination?.totalPages ?? 1;
  const apiTotalItems = pagination?.totalItems ?? stats?.totalMatches ?? filteredMatches.length;

  /* ── Active filter count for badge ──────────── */
  const activeFilterCount = [
    statusFilter !== 'all',
    leagueFilter !== 'all',
    kgFilter,
    goalFilter !== 'all',
    searchTerm.length > 0,
  ].filter(Boolean).length;

  const clearAllFilters = useCallback(() => {
    setStatusFilter('all');
    setLeagueFilter('all');
    setGoalFilter('all');
    setKgFilter(false);
    setSearchTerm('');
    setCurrentPage(1);
    fetchMatches(selectedDate, 1, '', endedMatchesHours);
  }, [fetchMatches, selectedDate, endedMatchesHours]);

  /* ═══════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════ */
  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-3 sm:py-6">

        {/* ── Compact Header (sticky, mobile scroll sırasında görünür) ── */}
        <div className="sticky top-0 z-30 -mx-2 sm:-mx-4 px-2 sm:px-4 pt-2 pb-2 mb-3 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur supports-[backdrop-filter]:bg-slate-50/80 supports-[backdrop-filter]:dark:bg-slate-900/80 border-b border-slate-200/50 dark:border-slate-700/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
              Futbol
            </h1>
            <div className="flex items-center gap-2 text-xs font-medium">
              <span className="text-slate-500 dark:text-slate-400">
                {stats?.totalMatches ?? 0} Mac
              </span>
              {(stats?.liveMatches ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500 text-white animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-white" />
                  {stats!.liveMatches} Canli
                </span>
              )}
              <span className="text-blue-600 dark:text-blue-400">
                {stats?.upcomingMatches ?? 0} Yaklasan
              </span>
              <span className="text-emerald-600 dark:text-emerald-400">
                {stats?.finishedMatches ?? 0} Biten
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/statistics">
              <button className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <ChartBar className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Istatistikler</span>
              </button>
            </Link>
            <Link href="/toplu-analiz">
              <button className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-orange-500 to-red-500 text-white hover:opacity-90 transition-all flex items-center gap-1.5 shadow-sm">
                <span>🔥</span>
                <span className="hidden sm:inline">Toplu Yüksek Değer</span>
              </button>
            </Link>
            <GoalAnalyzerPanel />
            <ThemeToggle />
          </div>
        </div>

        {/* ── Multi-Sport Navigation ────────────────── */}
        <nav className="mb-4 -mx-1 overflow-x-auto">
          <div className="flex items-center gap-1.5 px-1 whitespace-nowrap min-w-max">
            <Link href="/" className="inline-block">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white shadow-sm flex items-center gap-1.5"
                aria-current="page"
              >
                <span>⚽</span>
                <span>Futbol</span>
              </button>
            </Link>
            <Link href="/basketball" className="inline-block">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-slate-600 dark:text-slate-300"
              >
                <span>🏀</span>
                <span>Basketbol</span>
              </button>
            </Link>
            <Link href="/nba" className="inline-block">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-slate-600 dark:text-slate-300"
              >
                <span>🏀</span>
                <span>NBA</span>
              </button>
            </Link>
            <Link href="/hockey" className="inline-block">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-slate-600 dark:text-slate-300"
              >
                <span>🏒</span>
                <span>Hokey</span>
              </button>
            </Link>
            <Link href="/hockey-2" className="inline-block">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-slate-600 dark:text-slate-300"
              >
                <span>🏒</span>
                <span>Hockey-2</span>
              </button>
            </Link>
            <Link href="/volleyball" className="inline-block">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-slate-600 dark:text-slate-300"
              >
                <span>🏐</span>
                <span>Voleybol</span>
              </button>
            </Link>
            <Link href="/handball" className="inline-block">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-slate-600 dark:text-slate-300"
              >
                <span>🤾</span>
                <span>Hentbol</span>
              </button>
            </Link>
            <Link href="/iddaa-hockey" className="inline-block">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-slate-600 dark:text-slate-300"
              >
                <span>🎯</span>
                <span>İddaa Hokey</span>
              </button>
            </Link>
          </div>
        </nav>

        {/* ── Tab Navigation ──────────────────── */}
        <div className="mb-4">
          <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-1 inline-flex gap-1 flex-wrap">
            {([
              { value: 'matches', icon: CalendarDays, label: 'Maclar', count: stats?.totalMatches ?? 0 },
              { value: 'live', icon: Activity, label: 'Canli', count: stats?.liveMatches ?? 0 },
              { value: 'upcoming', icon: TrendingUp, label: 'Tahminler', count: stats?.upcomingMatches ?? 0 },
              { value: 'probet', icon: Brain, label: 'ProBet', count: null },
              { value: 'bulk-analysis', icon: ChartBar, label: 'Toplu Analiz', count: null },
              { value: 'standings', icon: Trophy, label: 'Siralamalar', count: null },
            ] as const).map((tab) => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                  activeTab === tab.value
                    ? tab.value === 'probet'
                      ? 'bg-gradient-to-r from-violet-500 to-blue-600 text-white shadow-sm'
                      : 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
                {tab.count !== null && (
                  <span className={`text-xs ${activeTab === tab.value ? 'opacity-80' : 'opacity-50'}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ═══ TAB CONTENT ═══════════════════════ */}

        {/* ── Matches Tab ─────────────────────── */}
        {activeTab === 'matches' && (
          <div ref={listTopRef}>
            {/* Filter Bar */}
            <ClientWrapper>
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 sm:p-3 mb-4">
                {/* Row 1: Date, Search, Refresh */}
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-2.5">
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm w-full sm:w-40"
                  />

                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Takim veya lig ara..."
                      value={searchTerm}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                    />
                    {searchTerm && (
                      <button
                        onClick={() => handleSearchChange('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0 self-stretch sm:self-auto"
                    title="Yenile"
                  >
                    <RefreshCw className={`w-4 h-4 text-slate-600 dark:text-slate-400 ${refreshing ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {/* Row 2: Status pills + Smart filters */}
                <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                  {/* Status Filters - using REAL stats counts */}
                  {([
                    { key: 'all' as StatusFilter, label: 'Tumu', count: stats?.totalMatches ?? 0, activeClass: 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white' },
                    { key: 'live' as StatusFilter, label: 'Canli', count: stats?.liveMatches ?? 0, activeClass: 'bg-red-500 text-white border-red-500' },
                    { key: 'upcoming' as StatusFilter, label: 'Yaklasan', count: stats?.upcomingMatches ?? 0, activeClass: 'bg-blue-500 text-white border-blue-500' },
                    { key: 'finished' as StatusFilter, label: 'Biten', count: stats?.finishedMatches ?? 0, activeClass: 'bg-emerald-500 text-white border-emerald-500' },
                  ]).map((btn) => (
                    <button
                      key={btn.key}
                      onClick={() => { setStatusFilter(btn.key as StatusFilter); setCurrentPage(1); }}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                        statusFilter === btn.key
                          ? btn.activeClass
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      {btn.label} <span className="opacity-80">{btn.count}</span>
                    </button>
                  ))}

                  {/* Separator */}
                  <span className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block" />

                  {/* KG (BTTS) Toggle */}
                  <button
                    onClick={() => { setKgFilter(!kgFilter); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                      kgFilter
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    KG Var
                  </button>

                  {/* Goal Filter Dropdown */}
                  <select
                    value={goalFilter}
                    onChange={(e) => { setGoalFilter(e.target.value as GoalFilter); setCurrentPage(1); }}
                    className="px-2 py-1 rounded-full text-[11px] font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 cursor-pointer"
                  >
                    <option value="all">Gol: Tumu</option>
                    <option value="0-1">Gol: 0-1</option>
                    <option value="2-3">Gol: 2-3</option>
                    <option value="4-5">Gol: 4-5</option>
                    <option value="6+">Gol: 6+</option>
                  </select>

                  {/* League Dropdown */}
                  {uniqueLeagues.length > 0 && (
                    <select
                      value={leagueFilter}
                      onChange={(e) => { setLeagueFilter(e.target.value); setCurrentPage(1); }}
                      className="px-2 py-1 rounded-full text-[11px] font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 cursor-pointer max-w-[160px] truncate"
                    >
                      <option value="all">Tum Ligler ({uniqueLeagues.length})</option>
                      {uniqueLeagues.map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  )}

                  {/* Clear all filters */}
                  {activeFilterCount > 0 && (
                    <button
                      onClick={clearAllFilters}
                      className="px-2.5 py-1 rounded-full text-[11px] font-medium border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    >
                      <X className="w-3 h-3 inline mr-0.5" />
                      Temizle ({activeFilterCount})
                    </button>
                  )}
                </div>

                {/* Row 3: Ended matches controls */}
                <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-700/50">
                  <button
                    onClick={toggleEndedMatches}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                      showEndedMatches
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    <History className="w-3 h-3" />
                    {showEndedMatches ? 'Biten Maclar' : 'Biten Maclari Goster'}
                  </button>

                  {showEndedMatches && (
                    <div className="flex items-center gap-2 ml-1">
                      <button
                        onClick={() => handleEndedMatchesNavigation('next')}
                        disabled={endedMatchesHours === 0}
                        className="px-2 py-1 rounded-lg text-[11px] font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                      >
                        <ChevronLeft className="w-3 h-3 inline" /> Yakin
                      </button>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        {endedMatchesHours}-{endedMatchesHours + 2}s
                      </span>
                      <button
                        onClick={() => handleEndedMatchesNavigation('prev')}
                        className="px-2 py-1 rounded-lg text-[11px] font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                      >
                        Uzak <ChevronRight className="w-3 h-3 inline" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </ClientWrapper>

            {/* Match List Content */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-violet-500 rounded-full animate-spin" />
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-4">Maclar yukleniyor...</p>
              </div>
            ) : error ? (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
                <p className="text-red-700 dark:text-red-400 font-medium mb-2">Maclar yuklenemedi</p>
                <p className="text-sm text-red-600/70 dark:text-red-400/70 mb-4">{error}</p>
                <button
                  onClick={handleRefresh}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors inline-flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Tekrar Dene
                </button>
              </div>
            ) : filteredMatches.length === 0 ? (
              <div className="text-center py-20 text-slate-500 dark:text-slate-400">
                <CalendarDays className="w-12 h-12 mx-auto mb-4 opacity-40" />
                <p className="font-medium mb-1">Mac bulunamadi</p>
                <p className="text-sm opacity-70">
                  {activeFilterCount > 0 ? 'Filtrelerinize uygun' : showEndedMatches ? 'Bu zaman araliginda biten' : 'Secilen tarih icin'} mac bulunamadi.
                </p>
                {activeFilterCount > 0 && (
                  <button
                    onClick={clearAllFilters}
                    className="mt-4 px-4 py-2 rounded-lg text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    Filtreleri Temizle
                  </button>
                )}
              </div>
            ) : (
              <div>
                {/* List Header */}
                <div className="flex items-center justify-between px-3 sm:px-4 py-2 mb-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {filteredMatches.length} mac{leagueFilter !== 'all' ? ` (filtrelenmis)` : ''}
                    {kgFilter ? ' · KG' : ''}
                    {goalFilter !== 'all' ? ` · ${goalFilter} gol` : ''}
                  </span>
                  {/* Column labels - desktop only */}
                  <div className="hidden md:flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    <span className="w-12 text-center">Saat</span>
                    <span className="w-32">Lig</span>
                    <span className="flex-1 text-right">Ev</span>
                    <span className="w-16 text-center">Skor</span>
                    <span className="flex-1">Deplasman</span>
                    <span className="w-20 text-center">Durum</span>
                    <span className="w-16"></span>
                  </div>
                </div>

                {/* Grouped Match List */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                  {groupedByLeague.map((group) => (
                    <div key={group.leagueId}>
                      <LeagueHeader
                        name={group.leagueName}
                        country={group.leagueCountry}
                        logo={group.leagueLogo}
                        count={group.matches.length}
                      />
                      {group.matches.map((match) => (
                        <MatchRow key={match.fixture?.id} match={match} />
                      ))}
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {apiTotalPages > 1 && (
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-5">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                      >
                        Onceki
                      </button>

                      {/* Page number buttons */}
                      {(() => {
                        const pages: number[] = [];
                        const total = apiTotalPages;
                        if (total <= 7) {
                          for (let i = 1; i <= total; i++) pages.push(i);
                        } else if (currentPage <= 4) {
                          for (let i = 1; i <= 5; i++) pages.push(i);
                          pages.push(-1); // ellipsis
                          pages.push(total);
                        } else if (currentPage >= total - 3) {
                          pages.push(1);
                          pages.push(-1);
                          for (let i = total - 4; i <= total; i++) pages.push(i);
                        } else {
                          pages.push(1);
                          pages.push(-1);
                          for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
                          pages.push(-2);
                          pages.push(total);
                        }
                        return pages.map((p, idx) =>
                          p < 0 ? (
                            <span key={`e${idx}`} className="px-1 text-slate-400">...</span>
                          ) : (
                            <button
                              key={p}
                              onClick={() => handlePageChange(p)}
                              className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                                currentPage === p
                                  ? 'bg-gradient-to-r from-violet-500 to-blue-600 text-white shadow-md'
                                  : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                              }`}
                            >
                              {p}
                            </button>
                          ),
                        );
                      })()}

                      <button
                        onClick={() => handlePageChange(Math.min(apiTotalPages, currentPage + 1))}
                        disabled={currentPage === apiTotalPages}
                        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                      >
                        Sonraki
                      </button>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>Sayfa</span>
                      <input
                        type="number"
                        min={1}
                        max={apiTotalPages}
                        value={currentPage}
                        onChange={(e) => {
                          const p = parseInt(e.target.value);
                          if (p >= 1 && p <= apiTotalPages) handlePageChange(p);
                        }}
                        className="w-12 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-center text-sm"
                      />
                      <span>/ {apiTotalPages} · {apiTotalItems} mac</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Live Matches Tab ────────────────── */}
        {activeTab === 'live' && (
          <>
            {(stats?.liveMatches ?? 0) === 0 ? (
              <div className="text-center py-20 text-slate-500 dark:text-slate-400">
                <Activity className="w-12 h-12 mx-auto mb-4 opacity-40" />
                <p className="font-medium mb-1">Su anda canli mac yok</p>
                <p className="text-sm opacity-70">Canli maclar otomatik olarak burada goruntulenir</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between px-1 mb-3">
                  <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-red-500" />
                    Canli Maclar
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white animate-pulse">
                    {stats?.liveMatches ?? 0} canli
                  </span>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                  {localLive.map((match) => (
                    <MatchRow key={match?.fixture?.id} match={match} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Predictions Tab ─────────────────── */}
        {activeTab === 'upcoming' && (
          <>
            {(stats?.upcomingMatches ?? 0) === 0 ? (
              <div className="text-center py-20 text-slate-500 dark:text-slate-400">
                <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-40" />
                <p className="font-medium mb-1">Tahmin edilecek mac yok</p>
                <p className="text-sm opacity-70">Yaklasan maclar icin AI tahminleri burada goruntulenir</p>
              </div>
            ) : (
              <OptimizedMatchListEnhanced
                matches={localUpcoming}
                loading={loading}
                error={error}
                onRetry={handleRefresh}
                searchPlaceholder="Yaklasan maclarda ara..."
                showPagination={true}
                pageSize={20}
                showHighConfidenceOnly={false}
              />
            )}
          </>
        )}

        {/* ── ProBet Tab ──────────────────────── */}
        {activeTab === 'probet' && <ProBetTab />}

        {/* ── Bulk Analysis Tab ───────────────── */}
        {activeTab === 'bulk-analysis' && (
          <div className="text-center py-16">
            <ChartBar className="w-12 h-12 mx-auto mb-4 text-violet-400 opacity-60" />
            <p className="font-medium text-slate-800 dark:text-slate-200 mb-1">Toplu Mac Analizi</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
              Gunun tum maclari icin kapsamli analiz
            </p>
            <Link href="/bulk-analysis">
              <button className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-violet-500 to-blue-600 text-white text-sm font-medium hover:opacity-90 transition-opacity inline-flex items-center gap-2">
                <ChartBar className="w-4 h-4" />
                Analiz Sayfasina Git
              </button>
            </Link>
          </div>
        )}

        {/* ── Standings Tab ───────────────────── */}
        {activeTab === 'standings' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <LeagueStandings leagueId={MAJOR_LEAGUES.PREMIER_LEAGUE} leagueName="Premier League" />
            <LeagueStandings leagueId={MAJOR_LEAGUES.LA_LIGA} leagueName="La Liga" />
            <LeagueStandings leagueId={MAJOR_LEAGUES.BUNDESLIGA} leagueName="Bundesliga" />
            <LeagueStandings leagueId={MAJOR_LEAGUES.SERIE_A} leagueName="Serie A" />
            <LeagueStandings leagueId={MAJOR_LEAGUES.LIGUE_1} leagueName="Ligue 1" />
            <LeagueStandings leagueId={MAJOR_LEAGUES.SUPER_LIG} leagueName="Super Lig" />
          </div>
        )}

      </div>
    </div>
  );
}
