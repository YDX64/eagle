
import { NextRequest } from 'next/server';
import { z } from 'zod';

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE || '60');

interface RateLimitData {
  count: number;
  resetTime: number;
}

// Simple in-memory rate limiting (use Redis in production)
const rateLimit = new Map<string, RateLimitData>();

export function getRateLimitKey(request: NextRequest): string {
  // In production, use proper IP detection
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : 'anonymous';
  return ip;
}

export function checkRateLimit(key: string): { allowed: boolean; resetTime?: number } {
  const now = Date.now();
  const data = rateLimit.get(key);

  if (!data || now > data.resetTime) {
    // Reset window
    rateLimit.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return { allowed: true };
  }

  if (data.count >= RATE_LIMIT_REQUESTS) {
    return { allowed: false, resetTime: data.resetTime };
  }

  // Increment count
  rateLimit.set(key, { ...data, count: data.count + 1 });
  return { allowed: true };
}

// Input validation schemas
export const matchesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(10000).default(25),
  search: z.string().max(100).optional(),
  endedMatchesHours: z.coerce.number().int().min(0).max(168).optional(), // Max 1 week
});

export const matchIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const leagueIdSchema = z.object({
  leagueId: z.coerce.number().int().positive(),
});

// API Response wrapper
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export function createSuccessResponse<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

export function createErrorResponse(error: string, statusCode?: number): { 
  response: ApiResponse; 
  status: number 
} {
  return {
    response: {
      success: false,
      error,
      timestamp: new Date().toISOString(),
    },
    status: statusCode || 500,
  };
}

// Environment validation
export function validateApiKey(): boolean {
  const apiKey = process.env.AWASTATS_API_KEY || process.env.API_FOOTBALL_KEY;
  return !!(apiKey && apiKey.length > 0 && apiKey !== 'your_awastats_key_here' && apiKey !== 'your_api_football_key_here');
}

// Error sanitization for production
export function sanitizeError(error: any): string {
  if (process.env.NODE_ENV === 'development') {
    return error?.message || error?.toString() || 'Unknown error';
  }
  
  // In production, return generic messages for security
  if (error?.name === 'ValidationError') {
    return 'Invalid request parameters';
  }
  
  if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
    return 'Service temporarily unavailable';
  }
  
  return 'An error occurred while processing your request';
}
