"use client";

import React from "react";
import { Box, Stack } from "@mui/material";
import BankoPrediction from "@/components/mui-analysis/ui/banko-prediction";
import CardCornerPrediction from "@/components/mui-analysis/ui/card-corner-prediction";

interface SpecialPredictionsProps {
  banko: {
    value: number;
    prediction: string;
    source: string;
  };
  cardCorner: {
    card: { prediction: string; value: number };
    corner: { prediction: string; value: number };
  };
}

export default function SpecialPredictions({ banko, cardCorner }: SpecialPredictionsProps) {
  return (
    <Stack spacing={3} sx={{ height: '100%' }}>
      <BankoPrediction 
        value={banko.value} 
        prediction={banko.prediction} 
        source={banko.source} 
      />
      <CardCornerPrediction 
        card={cardCorner.card} 
        corner={cardCorner.corner} 
      />
    </Stack>
  );
}