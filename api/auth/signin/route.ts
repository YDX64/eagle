
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  // Simple mock signin for testing - not a real authentication system
  return NextResponse.json({
    success: true,
    message: 'Signin successful',
    user: { id: 1, email: 'test@example.com' }
  });
}
