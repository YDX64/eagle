
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, Wifi, WifiOff } from 'lucide-react';

interface ApiErrorFallbackProps {
  error?: string;
  onRetry?: () => void;
  title?: string;
  description?: string;
  showRefresh?: boolean;
}

export function ApiErrorFallback({
  error,
  onRetry,
  title = 'Failed to load data',
  description = 'Unable to fetch the requested information. Please check your connection and try again.',
  showRefresh = true,
}: ApiErrorFallbackProps) {
  const isNetworkError = error?.toLowerCase()?.includes('network') || error?.toLowerCase()?.includes('fetch');

  return (
    <Card className="w-full">
      <CardHeader className="text-center pb-4">
        <div className="mx-auto w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center mb-3">
          {isNetworkError ? (
            <WifiOff className="w-6 h-6 text-orange-600 dark:text-orange-400" />
          ) : (
            <AlertTriangle className="w-6 h-6 text-orange-600 dark:text-orange-400" />
          )}
        </div>
        <CardTitle className="text-lg text-orange-800 dark:text-orange-200">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-center space-y-4">
        <p className="text-sm text-muted-foreground">
          {description}
        </p>
        {error && process.env.NODE_ENV === 'development' && (
          <div className="text-xs text-muted-foreground bg-muted p-2 rounded border font-mono text-left">
            {error}
          </div>
        )}
        {showRefresh && onRetry && (
          <Button onClick={onRetry} variant="outline" size="sm" className="mt-4">
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function ApiErrorInline({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
      <AlertTriangle className="w-4 h-4 text-orange-500" />
      <span>Failed to load</span>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry} className="h-auto p-1">
          <RefreshCw className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}
