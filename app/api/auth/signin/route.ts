import { NextRequest, NextResponse } from 'next/server';

// Credentials sign-in is handled by the NextAuth Credentials provider
// at /api/auth/callback/credentials. This legacy route is kept only to
// guide callers to the correct endpoint.
export async function POST(_request: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      error: 'Use POST /api/auth/callback/credentials or signIn() from next-auth/react',
    },
    { status: 410 }
  );
}
