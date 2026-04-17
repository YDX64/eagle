const path = require('path');

// Content Security Policy — locks the page down to same-origin script/style
// and the specific third-party hosts we actually use. `'unsafe-inline'` is
// retained because Next.js App Router emits inline bootstrap scripts; a
// nonce-based replacement is a larger refactor and is tracked separately.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://media.api-sports.io https://*.api-sports.io https://v3.football.api-sports.io",
  "font-src 'self' data:",
  "connect-src 'self' https://v3.football.api-sports.io https://*.api-sports.io https://*.awastats.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'Content-Security-Policy', value: CSP_DIRECTIVES },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: process.env.NEXT_OUTPUT_MODE,
  outputFileTracingRoot: path.join(__dirname, '../'),
  // Don't advertise the framework in responses.
  poweredByHeader: false,
  // Enable modern compression for smaller payload.
  compress: true,
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: { unoptimized: true },
  allowedDevOrigins: [
    '2195234c-6362-4bbf-9308-30d81205ccc9-00-2h5am7z8se23h.pike.replit.dev',
    '127.0.0.1',
    'localhost',
  ],
  async headers() {
    return [
      // API routes must never be cached by browsers/proxies — betting data
      // is time-sensitive.
      {
        source: '/api/:path*',
        headers: [
          ...securityHeaders,
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
      // Static Next.js build assets are content-hashed → cache forever.
      {
        source: '/_next/static/:path*',
        headers: [
          ...securityHeaders,
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // Public static files (images, fonts placed in /public)
      {
        source: '/:path*\\.(png|jpg|jpeg|gif|webp|avif|svg|ico|woff|woff2|ttf|otf)',
        headers: [
          ...securityHeaders,
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=86400' },
        ],
      },
      // Everything else — HTML pages: short cache + SWR to keep matches fresh.
      {
        source: '/(.*)',
        headers: [
          ...securityHeaders,
          { key: 'Cache-Control', value: 'no-store, max-age=0, must-revalidate' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
