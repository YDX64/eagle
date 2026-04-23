const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: process.env.NEXT_OUTPUT_MODE,
  // In Docker the app is the sole workspace; without this override the
  // standalone tracer walks up to `/` and emits a broken output layout.
  outputFileTracingRoot: __dirname,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: { unoptimized: true },
  // Allow all origins for Replit environment  
  allowedDevOrigins: [
    "2195234c-6362-4bbf-9308-30d81205ccc9-00-2h5am7z8se23h.pike.replit.dev",
    "127.0.0.1",
    "localhost"
  ],
  // Add cache headers for Replit
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
    ]
  },
};

module.exports = nextConfig;
