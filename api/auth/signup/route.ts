
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  // Simple mock signup for testing - not a real authentication system
  return NextResponse.json({
    success: true,
    message: 'Signup successful',
    user: { id: 1, email: 'test@example.com' }
  });
}
