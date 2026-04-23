
import { NextRequest, NextResponse } from 'next/server';
import { 
  checkRateLimit, 
  getRateLimitKey, 
  createErrorResponse, 
  createSuccessResponse,
  validateApiKey,
  sanitizeError,
  type ApiResponse
} from './api-security';

// Higher-order function for API route protection
export function withApiProtection<T extends any[]>(
  handler: (request: NextRequest, ...args: T) => Promise<NextResponse>,
  options: {
    requireAuth?: boolean;
    rateLimit?: boolean;
    validateApiKey?: boolean;
  } = {}
) {
  const { rateLimit: enableRateLimit = true, validateApiKey: checkApiKey = false } = options;

  return async (request: NextRequest, ...args: T): Promise<NextResponse> => {
    try {
      // Rate limiting
      if (enableRateLimit) {
        const rateLimitKey = getRateLimitKey(request);
        const { allowed, resetTime } = checkRateLimit(rateLimitKey);
        
        if (!allowed) {
          const response = NextResponse.json(
            createErrorResponse('Too many requests. Please try again later.', 429).response,
            { status: 429 }
          );
          
          if (resetTime) {
            response.headers.set('Retry-After', Math.ceil((resetTime - Date.now()) / 1000).toString());
          }
          
          return response;
        }
      }

      // API key validation
      if (checkApiKey && !validateApiKey()) {
        const { response, status } = createErrorResponse('API configuration error', 503);
        return NextResponse.json(response, { status });
      }

      // Call the actual handler
      return await handler(request, ...args);
    } catch (error) {
      const sanitizedError = sanitizeError(error);
      const { response, status } = createErrorResponse(sanitizedError, 500);
      return NextResponse.json(response, { status });
    }
  };
}

// Utility for consistent error handling
export function handleApiError(error: any): NextResponse {
  const sanitizedError = sanitizeError(error);
  const { response, status } = createErrorResponse(sanitizedError);
  return NextResponse.json(response, { status });
}

// Utility for consistent success responses
export function createApiResponse<T>(data: T): NextResponse {
  return NextResponse.json(createSuccessResponse(data));
}

// Parse and validate query parameters
export function parseQueryParams<T>(
  request: NextRequest,
  schema: any
): { success: true; data: T } | { success: false; error: string } {
  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = schema.parse(searchParams);
    return { success: true, data: parsed };
  } catch (error: any) {
    const message = error?.errors?.[0]?.message || 'Invalid query parameters';
    return { success: false, error: message };
  }
}

// CORS headers for production
export function addCorsHeaders(response: NextResponse): NextResponse {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
  
  response.headers.set('Access-Control-Allow-Origin', allowedOrigins[0]);
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  return response;
}

export type { ApiResponse };
