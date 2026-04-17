
import { useCallback, useMemo, useRef } from 'react';

// Debounce hook for search inputs
export function useDebounce<T extends any[]>(
  fn: (...args: T) => void,
  delay: number
) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  return useCallback((...args: T) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]);
}

// Throttle hook for scroll events
export function useThrottle<T extends any[]>(
  fn: (...args: T) => void,
  limit: number
) {
  const inThrottle = useRef(false);

  return useCallback((...args: T) => {
    if (!inThrottle.current) {
      fn(...args);
      inThrottle.current = true;
      setTimeout(() => (inThrottle.current = false), limit);
    }
  }, [fn, limit]);
}

// Memoized match filtering
export function useMatchFilters(matches: any[], searchTerm: string, filters: any) {
  return useMemo(() => {
    if (!matches?.length) return [];
    
    let filtered = matches;
    
    // Search filter
    if (searchTerm?.trim()) {
      const search = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(match =>
        match?.teams?.home?.name?.toLowerCase()?.includes(search) ||
        match?.teams?.away?.name?.toLowerCase()?.includes(search) ||
        match?.league?.name?.toLowerCase()?.includes(search) ||
        match?.league?.country?.toLowerCase()?.includes(search)
      );
    }
    
    // Additional filters can be added here
    return filtered;
  }, [matches, searchTerm, filters]);
}

// Performance monitoring (development only)
export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private measurements = new Map<string, number>();

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  startMeasurement(name: string): void {
    if (process.env.NODE_ENV === 'development') {
      this.measurements.set(name, performance.now());
    }
  }

  endMeasurement(name: string): number | null {
    if (process.env.NODE_ENV === 'development' && this.measurements.has(name)) {
      const start = this.measurements.get(name)!;
      const duration = performance.now() - start;
      this.measurements.delete(name);
      
      if (duration > 100) { // Log slow operations
        console.warn(`Slow operation: ${name} took ${duration.toFixed(2)}ms`);
      }
      
      return duration;
    }
    return null;
  }

  withMeasurement<T>(name: string, fn: () => T): T {
    this.startMeasurement(name);
    try {
      const result = fn();
      return result;
    } finally {
      this.endMeasurement(name);
    }
  }
}

export const perf = PerformanceMonitor.getInstance();

// Memory-efficient pagination hook
export function usePaginatedData<T>(data: T[], pageSize: number = 25) {
  return useMemo(() => {
    const totalPages = Math.ceil((data?.length || 0) / pageSize);
    
    const getPageData = (page: number) => {
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      return data?.slice(startIndex, endIndex) || [];
    };
    
    return {
      totalPages,
      totalItems: data?.length || 0,
      getPageData,
      hasNextPage: (page: number) => page < totalPages,
      hasPrevPage: (page: number) => page > 1,
    };
  }, [data, pageSize]);
}

// Image loading optimization
export function optimizeImageUrl(url: string, size: 'small' | 'medium' | 'large' = 'medium'): string {
  if (!url) return '';
  
  // Upstream provider image sizing support
  if (url.includes('api-sports.io')) {
    const sizeParam = {
      small: '?w=40&h=40',
      medium: '?w=80&h=80', 
      large: '?w=120&h=120'
    }[size];
    return `${url}${sizeParam}`;
  }
  
  return url;
}
