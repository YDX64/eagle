
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Simple mock CSRF token for testing - not a real authentication system
  return NextResponse.json({
    csrfToken: 'mock-csrf-token-for-testing'
  });
}
