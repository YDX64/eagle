import { NextRequest, NextResponse } from 'next/server';

export const dynamic = "force-dynamic";

const UPSTREAM_URL = process.env.AWASTATS_STATUS_URL || 'https://v3.football.api-sports.io/status';

export async function GET(_request: NextRequest) {
  try {
    const API_KEY = process.env.AWASTATS_API_KEY || process.env.API_FOOTBALL_KEY;
    const response = await fetch(UPSTREAM_URL, {
      method: 'GET',
      headers: {
        'x-apisports-key': API_KEY!,
        'Content-Type': 'application/json',
      },
      cache: 'no-store'
    });

    const upstream = await response.json();
    const account = upstream?.response?.account ?? null;
    const subscription = upstream?.response?.subscription ?? null;
    const requests = upstream?.response?.requests ?? null;

    return NextResponse.json({
      success: true,
      provider: 'awastats',
      data: {
        account: account ? {
          plan: subscription?.plan ?? null,
          active: subscription?.active ?? null,
          end: subscription?.end ?? null,
        } : null,
        requests: requests ? {
          current: requests.current ?? null,
          limitDay: requests.limit_day ?? null,
        } : null,
      },
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
        provider: 'awastats',
        error: 'Veri servisi durumu alınamadı',
        message: error instanceof Error ? error.message : 'Bilinmeyen hata'
      },
      { status: 500 }
    );
  }
}
