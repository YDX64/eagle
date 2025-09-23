
import type { Metadata } from 'next';

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string[];
  image?: string;
  url?: string;
  type?: string;
}

export function generateSEO({
  title = 'Football Prediction System | AI-Powered Match Analysis',
  description = 'Advanced football match predictions using comprehensive data analysis, team form, head-to-head records, and machine learning algorithms.',
  keywords = ['football', 'soccer', 'predictions', 'match analysis', 'AI', 'machine learning', 'statistics'],
  image = '/og-image.png',
  url = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  type = 'website'
}: SEOProps = {}): Metadata {
  const siteUrl = url.endsWith('/') ? url.slice(0, -1) : url;
  const fullImageUrl = image.startsWith('http') ? image : `${siteUrl}${image}`;

  return {
    title,
    description,
    keywords: keywords.join(', '),
    authors: [{ name: 'Football Prediction System' }],
    creator: 'Football Prediction System',
    publisher: 'Football Prediction System',
    alternates: {
      canonical: siteUrl,
    },
    openGraph: {
      title,
      description,
      url: siteUrl,
      siteName: 'Football Prediction System',
      images: [
        {
          url: fullImageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      locale: 'en_US',
      type: type as any,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [fullImageUrl],
      creator: '@footballpreds',
    },
    robots: {
      index: true,
      follow: true,
      nocache: false,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    verification: {
      // Add your verification tokens here
      google: process.env.GOOGLE_VERIFICATION_TOKEN,
    },
  };
}

// Page-specific SEO helpers
export const SEO_PAGES = {
  home: {
    title: 'Football Predictions | Live Match Analysis & AI Predictions',
    description: 'Get real-time football predictions and live match analysis. Our AI analyzes team performance, statistics, and historical data to provide accurate match predictions.',
    keywords: ['live football predictions', 'match analysis', 'football AI', 'soccer predictions today']
  },
  matches: {
    title: 'Today\'s Football Matches | Live Scores & Predictions',
    description: 'View today\'s football matches with live scores, team statistics, and AI-powered predictions. Stay updated with real-time match data.',
    keywords: ['today football matches', 'live scores', 'match predictions', 'football fixtures']
  },
  predictions: {
    title: 'Football Match Predictions | AI Analysis & Statistics',
    description: 'Advanced AI-powered football predictions based on team form, head-to-head records, player statistics, and machine learning algorithms.',
    keywords: ['football predictions', 'match analysis', 'AI predictions', 'betting predictions', 'soccer analysis']
  },
  standings: {
    title: 'Football League Standings | Live Tables & Statistics',
    description: 'View current football league standings, team positions, points, and detailed statistics for major leagues worldwide.',
    keywords: ['football standings', 'league tables', 'team positions', 'football statistics', 'league rankings']
  }
} as const;
