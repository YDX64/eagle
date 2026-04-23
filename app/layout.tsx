
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as HotToaster } from 'react-hot-toast';

const inter = Inter({ 
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Football Prediction System | AI-Powered Match Analysis',
  description: 'Advanced football match predictions using comprehensive data analysis, team form, head-to-head records, and machine learning algorithms.',
  keywords: 'football, soccer, predictions, match analysis, AI, machine learning, statistics, betting',
  authors: [{ name: 'Football Prediction System' }],
  openGraph: {
    title: 'Football Prediction System',
    description: 'AI-Powered Football Match Analysis & Predictions',
    type: 'website',
    locale: 'en_US',
    siteName: 'Football Prediction System',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Football Prediction System',
    description: 'AI-Powered Football Match Analysis & Predictions',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover', // iOS notch / safe-area kullanımı için
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#10b981' },
    { media: '(prefers-color-scheme: dark)', color: '#065f46' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className={`${inter.className} antialiased`} suppressHydrationWarning>
        <ErrorBoundary>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            <Toaster />
            <HotToaster position="top-right" />
          </ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
