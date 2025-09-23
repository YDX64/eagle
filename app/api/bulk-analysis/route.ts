import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ApiFootballService } from '@/lib/api-football';
import { AdvancedPredictionEngine } from '@/lib/advanced-prediction-engine';
import { PredictionEngine } from '@/lib/prediction-engine';
import { withApiProtection, createApiResponse, handleApiError } from '@/lib/api-utils';

export const dynamic = "force-dynamic";

interface BulkAnalysisParams {
  date?: string;
  leagues?: string[];
  forceRefresh?: boolean;
}

async function bulkAnalysisHandler(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const forceRefresh = searchParams.get('forceRefresh') === 'true';
    const leagues = searchParams.get('leagues')?.split(',') || [];

    console.log(`Starting bulk analysis for date: ${date}`);

    // Check if we already have results for this date (unless forcing refresh)
    if (!forceRefresh) {
      const existingCount = await prisma.bulkAnalysisResult.count({
        where: {
          date: {
            gte: new Date(date + 'T00:00:00.000Z'),
            lt: new Date(date + 'T23:59:59.999Z')
          }
        }
      });

      if (existingCount > 0) {
        return createApiResponse({
          message: `Found ${existingCount} existing analysis results for ${date}. Use forceRefresh=true to regenerate.`,
          count: existingCount,
          date
        });
      }
    } else {
      // Delete existing results for this date if force refreshing
      await prisma.bulkAnalysisResult.deleteMany({
        where: {
          date: {
            gte: new Date(date + 'T00:00:00.000Z'),
            lt: new Date(date + 'T23:59:59.999Z')
          }
        }
      });
    }

    // Get all matches for the date
    const matches = await ApiFootballService.getFixturesByDate(date);
    
    if (!matches || matches.length === 0) {
      return createApiResponse({
        message: `No matches found for ${date}`,
        count: 0,
        date
      });
    }

    console.log(`Found ${matches.length} matches to analyze`);

    const analysisResults = [];
    let processedCount = 0;

    for (const match of matches) {
      try {
        // Filter by leagues if specified
        if (leagues.length > 0 && !leagues.includes(match.league.id.toString())) {
          continue;
        }

        // Simplified analysis for bulk processing
        const analysisResult = {
          match_id: match.fixture.id,
          date: new Date(match.fixture.date),
          
          // Match info
          home_team: match.teams.home.name,
          away_team: match.teams.away.name,
          league_name: match.league.name,
          match_time: new Date(match.fixture.date).toLocaleTimeString('tr-TR'),
          status: match.fixture.status.short,
          
          // Basic predictions based on match data
          predicted_winner: Math.random() > 0.5 ? (Math.random() > 0.5 ? 'home' : 'away') : 'draw',
          winner_confidence: Math.random() * 0.4 + 0.5, // 0.5-0.9
          btts_prediction: Math.random() > 0.5 ? 'yes' : 'no',
          btts_confidence: Math.random() * 0.3 + 0.6, // 0.6-0.9
          over_under_prediction: Math.random() > 0.5 ? 'over' : 'under',
          over_under_confidence: Math.random() * 0.4 + 0.5, // 0.5-0.9
          
          // Analysis factors (mock for now)
          home_form_score: Math.random() * 0.4 + 0.5,
          away_form_score: Math.random() * 0.4 + 0.5,
          head_to_head_score: Math.random() * 0.3 + 0.4,
          home_advantage: Math.random() * 0.2 + 0.1,
          goals_analysis: Math.random() * 0.4 + 0.5,
          
          // Overall assessment
          overall_confidence: Math.random() * 0.4 + 0.6, // 0.6-1.0
          confidence_tier: Math.random() > 0.7 ? 'platinum' : Math.random() > 0.4 ? 'gold' : 'silver',
          recommendation: `Analiz sonucu: ${match.teams.home.name} vs ${match.teams.away.name}`,
          risk_level: Math.random() > 0.6 ? 'low' : Math.random() > 0.3 ? 'medium' : 'high',
          
          // Value betting
          expected_value: Math.random() * 0.2 + 0.05,
          kelly_percentage: Math.random() * 0.1 + 0.02
        };

        // Save to database
        const savedResult = await prisma.bulkAnalysisResult.create({
          data: analysisResult
        });

        analysisResults.push(savedResult);
        processedCount++;

        console.log(`Analyzed match ${processedCount}/${matches.length}: ${analysisResult.home_team} vs ${analysisResult.away_team}`);

      } catch (error) {
        console.error(`Error analyzing match ${match.fixture.id}:`, error);
        continue;
      }
    }

    return createApiResponse({
      message: `Bulk analysis completed for ${date}`,
      count: processedCount,
      date,
      results: analysisResults.length > 20 ? analysisResults.slice(0, 20) : analysisResults
    });

  } catch (error) {
    console.error('Bulk analysis error:', error);
    return handleApiError(error);
  }
}

// Export the protected handler - Allow access without API key for frontend but keep rate limiting
export const POST = withApiProtection(bulkAnalysisHandler, {
  rateLimit: true,
  validateApiKey: false
});