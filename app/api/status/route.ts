
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const API_KEY = process.env.API_FOOTBALL_KEY;
    const response = await fetch('https://v3.football.api-sports.io/status', {
      method: 'GET',
      headers: {
        'x-apisports-key': API_KEY!,
        'Content-Type': 'application/json',
      },
      cache: 'no-store'
    });

    const data = await response.json();
    
    return NextResponse.json({
      success: true,
      data: data,
      rateLimit: {
        dailyLimit: response.headers.get('x-ratelimit-requests-limit'),
        dailyRemaining: response.headers.get('x-ratelimit-requests-remaining'),
        minuteLimit: response.headers.get('X-RateLimit-Limit'),
        minuteRemaining: response.headers.get('X-RateLimit-Remaining'),
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch API status',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
