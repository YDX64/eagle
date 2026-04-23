'use client';

import { useEffect, useState } from 'react';

interface ClientWrapperProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function ClientWrapper({ children, fallback = null }: ClientWrapperProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}