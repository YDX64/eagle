import React from "react";
import { Box, Typography } from "@mui/material";

interface ScoreDisplayProps {
  home: number;
  away: number;
}

export default function ScoreDisplay({ home, away }: ScoreDisplayProps) {
  return (
    <Box sx={{ textAlign: 'center', mb: 2 }}>
      <Typography variant="h2" fontWeight="bold" color="primary.light">
        {home} : {away}
      </Typography>
    </Box>
  );
}