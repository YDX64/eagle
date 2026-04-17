import { NextRequest, NextResponse } from 'next/server';

// IMPORTANT: Development stub — see /api/auth/signin for notes.
export async function POST(_request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { success: false, error: 'Authentication endpoint disabled in production' },
      { status: 503 }
    );
  }
  return NextResponse.json({
    success: true,
    message: 'Signup successful (development stub)',
    user: { id: 1, email: 'test@example.com' },
  });
}
