"use client";

import React from "react";
import { Box, Container, Paper, Typography } from "@mui/material";
import MatchHeader from "@/components/mui-analysis/match-header";
import PredictionGrid from "@/components/mui-analysis/prediction-grid";
import ColorLegend from "@/components/mui-analysis/ui/color-legend";
import type { BettingPredictionData, PredictionSegment } from "@/lib/mui-data-mapper";

interface BettingPredictionProps {
  matchData?: BettingPredictionData["matchData"];
  predictions?: BettingPredictionData["predictions"];
}

const createDefaultSegment = (): PredictionSegment => ({
  score: { home: 0, away: 0 },
  odds: {
    home: { value: 0, percentage: 0 },
    draw: { value: 0, percentage: 0 },
    away: { value: 0, percentage: 0 },
  },
  mainPrediction: "-",
  stats: [],
});

const createDefaultMatchData = (): BettingPredictionData["matchData"] => ({
  league: "",
  date: "",
  time: "",
  homeTeam: {
    name: "",
    logo: "",
    position: "—",
    form: ["draw", "draw", "draw", "draw", "draw"],
  },
  awayTeam: {
    name: "",
    logo: "",
    position: "—",
    form: ["draw", "draw", "draw", "draw", "draw"],
  },
});

const ensurePredictions = (
  predictions?: BettingPredictionData["predictions"]
): BettingPredictionData["predictions"] => ({
  firstHalf: predictions?.firstHalf ?? createDefaultSegment(),
  fullTime: predictions?.fullTime ?? createDefaultSegment(),
  banko: predictions?.banko ?? {
    value: 0,
    prediction: "Model data unavailable",
    source: "ava-football.ai",
  },
  cardCorner: predictions?.cardCorner ?? {
    card: { prediction: "Total Cards: Over 3.5", value: 0 },
    corner: { prediction: "Total Corners: Over 8.5", value: 0 },
  },
});

export default function BettingPrediction({ matchData, predictions }: BettingPredictionProps) {
  const resolvedMatchData = matchData ?? createDefaultMatchData();
  const resolvedPredictions = ensurePredictions(predictions);

  const hasData = Boolean(matchData && predictions);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        p: { xs: 2, md: 3 },
        bgcolor: "background.default",
      }}
    >
      <Container maxWidth="xl" sx={{ p: 0 }}>
        <Paper
          elevation={8}
          sx={{
            overflow: "hidden",
            bgcolor: "grey.800",
            border: 1,
            borderColor: "grey.700",
            borderRadius: 1,
          }}
        >
          <MatchHeader matchData={resolvedMatchData} />
          <PredictionGrid predictions={resolvedPredictions} />
          <Box sx={{ p: { xs: 2, sm: 3, md: 4 }, pt: 0 }}>
            {!hasData && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 2, textAlign: "center" }}
              >
                Detailed prediction data is currently unavailable. Displaying fallback layout.
              </Typography>
            )}
            <ColorLegend />
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
