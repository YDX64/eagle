"use client";

import React from "react";
import { Box, Grid } from "@mui/material";
import FirstHalfPrediction from "@/components/mui-analysis/predictions/first-half-prediction";
import FullTimePrediction from "@/components/mui-analysis/predictions/full-time-prediction";
import SpecialPredictions from "@/components/mui-analysis/predictions/special-predictions";

interface PredictionGridProps {
  predictions: {
    firstHalf: any;
    fullTime: any;
    banko: {
      value: number;
      prediction: string;
      source: string;
    };
    cardCorner: {
      card: { prediction: string; value: number };
      corner: { prediction: string; value: number };
    };
  };
}

export default function PredictionGrid({ predictions }: PredictionGridProps) {
  return (
    <Box sx={{ p: { xs: 2, sm: 3, md: 4 } }}>
      <Grid container spacing={3}>
        <Grid item xs={12} md={4} order={{ xs: 2, md: 1 }}>
          <FirstHalfPrediction prediction={predictions.firstHalf} />
        </Grid>
        
        <Grid item xs={12} md={4} order={{ xs: 1, md: 2 }}>
          <SpecialPredictions banko={predictions.banko} cardCorner={predictions.cardCorner} />
        </Grid>
        
        <Grid item xs={12} md={4} order={{ xs: 3, md: 3 }}>
          <FullTimePrediction prediction={predictions.fullTime} />
        </Grid>
      </Grid>
    </Box>
  );
}