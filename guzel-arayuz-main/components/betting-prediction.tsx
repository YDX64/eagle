"use client";

import React from "react";
import { Box, Container, Paper } from "@mui/material";
import MatchHeader from "@/components/match-header";
import PredictionGrid from "@/components/prediction-grid";
import ColorLegend from "@/components/ui/color-legend";

export default function BettingPrediction() {
  // Sample match data - in a real app, this would come from an API
  const matchData = {
    league: "BRAZIL SERIE A",
    date: "28-06-2024",
    time: "01:00 FRIDAY-2",
    homeTeam: {
      name: "Sao Paulo",
      logo: "https://logos-world.net/wp-content/uploads/2020/06/Sao-Paulo-Logo.png",
      position: "12th",
      form: ["win", "loss", "win", "draw", "loss"],
    },
    awayTeam: {
      name: "Criciuma",
      logo: "https://logoeps.com/wp-content/uploads/2014/03/criciuma-vector-logo.png",
      position: "13th",
      form: ["loss", "draw", "win", "win", "loss"],
    },
    predictions: {
      firstHalf: {
        score: { home: 0, away: 0 },
        odds: { 
          home: { value: 2.10, percentage: 31 },
          draw: { value: 2.20, percentage: 50 },
          away: { value: 6.50, percentage: 20 }
        },
        mainPrediction: "X",
        stats: [
          { name: "[Over 0.5]", value: 78, isHigh: true },
          { name: "[Under 1.5]", value: 60, isMedium: true },
          { name: "[Under 2.5]", value: 83, isHigh: true },
          { name: "1X", value: 72, isHigh: true, isHighlighted: true },
          { name: "[Under 3.5]", value: 94, isHigh: true },
          { name: "[BTTS No]", value: 76, isHigh: true },
        ],
      },
      fullTime: {
        score: { home: 2, away: 1 },
        odds: { 
          home: { value: 1.55, percentage: 44 },
          draw: { value: 4.10, percentage: 28 },
          away: { value: 6.00, percentage: 27 }
        },
        mainPrediction: "1",
        stats: [
          { name: "[Over 0.5]", value: 92, isHigh: true },
          { name: "[Over 1.5]", value: 80, isHigh: true },
          { name: "[Under 2.5]", value: 55, isMedium: true },
          { name: "[Under 3.5]", value: 81, isHigh: true },
          { name: "[BTTS Yes]", value: 55, isMedium: true },
          { name: "[2-3 Goals]", value: 61, isMedium: true },
        ],
      },
      banko: {
        value: 81,
        prediction: "FT [Under 3.5]",
        source: "awastats.com"
      },
      cardCorner: {
        card: { prediction: "Total Cards: Over 3.5", value: 75 },
        corner: { prediction: "Total Corners: Over 8.5", value: 68 }
      }
    }
  };

  return (
    <Box 
      sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        minHeight: '100vh', 
        p: 2, 
        bgcolor: 'background.default' 
      }}
    >
      <Container maxWidth="xl" sx={{ p: 0 }}>
        <Paper 
          elevation={8} 
          sx={{ 
            overflow: 'hidden', 
            bgcolor: 'grey.800',
            border: 1, 
            borderColor: 'grey.700',
            borderRadius: 1
          }}
        >
          <MatchHeader matchData={matchData} />
          <PredictionGrid predictions={matchData.predictions} />
          <Box sx={{ p: { xs: 2, sm: 3, md: 4 }, pt: 0 }}>
            <ColorLegend />
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}