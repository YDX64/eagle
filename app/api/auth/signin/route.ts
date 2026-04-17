import { NextRequest, NextResponse } from 'next/server';

// IMPORTANT: This endpoint is a development-only stub. The real
// authentication flow must go through NextAuth.js. In production the
// middleware blocks this path entirely, but we double-guard here in
// case middleware matching is mis-configured.
export async function POST(_request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { success: false, error: 'Authentication endpoint disabled in production' },
      { status: 503 }
    );
  }
  return NextResponse.json({
    success: true,
    message: 'Signin successful (development stub)',
    user: { id: 1, email: 'test@example.com' },
  });
}
