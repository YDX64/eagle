import React from "react";
import { Paper, Typography, Box } from "@mui/material";

interface OddsBoxProps {
  value: number;
  percentage: number;
}

export default function OddsBox({ value, percentage }: OddsBoxProps) {
  return (
    <Paper sx={{ p: 1, textAlign: 'center', bgcolor: 'grey.700' }}>
      <Typography variant="h6" fontWeight="bold" color="white">
        {value.toFixed(2)}
      </Typography>
      <Typography variant="caption" color="grey.300">
        {percentage}%
      </Typography>
    </Paper>
  );
}