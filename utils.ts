import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { Fixture } from "@/lib/api-football"
 
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
}

// Stockholm timezone utilities
export const STOCKHOLM_TIMEZONE = 'Europe/Stockholm';

export function formatToStockholmTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString('sv-SE', {
    timeZone: STOCKHOLM_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

export function formatToStockholmDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('sv-SE', {
    timeZone: STOCKHOLM_TIMEZONE,
    day: '2-digit',
    month: '2-digit'
  });
}

export function formatToStockholmDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('sv-SE', {
    timeZone: STOCKHOLM_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

export function getStockholmTimestamp(dateString: string): number {
  return new Date(dateString).getTime();
}

// Enhanced match sorting utilities
export function sortMatchesByTimeAndStatus(matches: Fixture[]): Fixture[] {
  const now = new Date().getTime();
  
  return matches.sort((a, b) => {
    const aTime = getStockholmTimestamp(a.fixture.date);
    const bTime = getStockholmTimestamp(b.fixture.date);
    
    // Status priority: Live matches first
    const aIsLive = ['1H', '2H', 'HT'].includes(a.fixture.status.short);
    const bIsLive = ['1H', '2H', 'HT'].includes(b.fixture.status.short);
    
    if (aIsLive && !bIsLive) return -1;
    if (!aIsLive && bIsLive) return 1;
    
    // If both are live, sort by how close to finishing (elapsed time desc)
    if (aIsLive && bIsLive) {
      const aElapsed = a.fixture.status.elapsed || 0;
      const bElapsed = b.fixture.status.elapsed || 0;
      return bElapsed - aElapsed; // Higher elapsed time first (about to finish)
    }
    
    // For non-live matches, sort by time (closest to now first)
    const aDistance = Math.abs(aTime - now);
    const bDistance = Math.abs(bTime - now);
    
    return aDistance - bDistance;
  });
}

// Pagination utilities
export interface PaginationResult<T> {
  data: T[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export function paginateArray<T>(
  array: T[], 
  page: number, 
  itemsPerPage: number = 25
): PaginationResult<T> {
  const totalItems = array?.length ?? 0;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const currentPage = Math.max(1, Math.min(page, totalPages));
  
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const data = array?.slice(startIndex, endIndex) ?? [];
  
  return {
    data,
    currentPage,
    totalPages,
    totalItems,
    hasNextPage: currentPage < totalPages,
    hasPrevPage: currentPage > 1
  };
}

// Enhanced filtering utilities
export function filterMatches(matches: Fixture[], searchTerm: string): Fixture[] {
  if (!searchTerm?.trim()) return matches;
  
  const term = searchTerm.toLowerCase().trim();
  
  return matches?.filter(match => 
    match?.teams?.home?.name?.toLowerCase()?.includes(term) ||
    match?.teams?.away?.name?.toLowerCase()?.includes(term) ||
    match?.league?.name?.toLowerCase()?.includes(term) ||
    match?.league?.country?.toLowerCase()?.includes(term)
  ) ?? [];
}

// Ended matches utilities (for 2-hour intervals)
export function getEndedMatchesTimeRanges(hoursBack: number = 2): {
  start: string;
  end: string;
  label: string;
} {
  const now = new Date();
  const endTime = new Date(now.getTime() - (hoursBack * 60 * 60 * 1000));
  const startTime = new Date(endTime.getTime() - (2 * 60 * 60 * 1000)); // 2 hours before end time
  
  return {
    start: startTime.toISOString().split('T')[0],
    end: endTime.toISOString().split('T')[0],
    label: `${hoursBack}-${hoursBack + 2} saat önce`
  };
}

// Dark mode utilities
export function getStoredTheme(): 'light' | 'dark' | 'system' {
  if (typeof window === 'undefined') return 'system';
  return (localStorage.getItem('theme') as 'light' | 'dark' | 'system') || 'system';
}

export function setStoredTheme(theme: 'light' | 'dark' | 'system'): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('theme', theme);
}