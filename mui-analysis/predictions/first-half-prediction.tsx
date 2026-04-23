"use client";

import React from "react";
import { Card, Box, Typography, Grid, Paper, LinearProgress } from "@mui/material";
import { styled } from "@mui/material/styles";
import { Wallpaper as SoccerBall } from "lucide-react";
import SectionTitle from "@/components/mui-analysis/ui/section-title";
import ScoreDisplay from "@/components/mui-analysis/ui/score-display";
import OddsBox from "@/components/mui-analysis/ui/odds-box";
import PredictionDisplay from "@/components/mui-analysis/ui/prediction-display";
import StatBox from "@/components/mui-analysis/ui/stat-box";

const PredictionCard = styled(Card)(({ theme }) => ({
  padding: theme.spacing(2),
  height: '100%',
}));

interface FirstHalfPredictionProps {
  prediction: {
    score: { home: number; away: number };
    odds: {
      home: { value: number; percentage: number };
      draw: { value: number; percentage: number };
      away: { value: number; percentage: number };
    };
    mainPrediction: string;
    stats: Array<{
      name: string;
      value: number;
      isHigh?: boolean;
      isMedium?: boolean;
      isHighlighted?: boolean;
    }>;
  };
}

export default function FirstHalfPrediction({ prediction }: FirstHalfPredictionProps) {
  return (
    <PredictionCard>
      <SectionTitle icon={<SoccerBall />} title="FIRST HALF" />
      
      <ScoreDisplay home={prediction.score.home} away={prediction.score.away} />
      
      <Grid container spacing={1} sx={{ mb: 2 }}>
        <Grid item xs={4}>
          <OddsBox 
            value={prediction.odds.home.value} 
            percentage={prediction.odds.home.percentage} 
          />
        </Grid>
        <Grid item xs={4}>
          <OddsBox 
            value={prediction.odds.draw.value} 
            percentage={prediction.odds.draw.percentage} 
          />
        </Grid>
        <Grid item xs={4}>
          <OddsBox 
            value={prediction.odds.away.value} 
            percentage={prediction.odds.away.percentage} 
          />
        </Grid>
      </Grid>
      
      <PredictionDisplay value={prediction.mainPrediction} />
      
      <Grid container spacing={1}>
        {prediction.stats.map((stat, index) => (
          <Grid item xs={4} key={index}>
            <StatBox 
              percentage={stat.value} 
              label={stat.name} 
              isHigh={stat.isHigh}
              isMedium={stat.isMedium}
              isHighlighted={stat.isHighlighted}
            />
          </Grid>
        ))}
      </Grid>
    </PredictionCard>
  );
}