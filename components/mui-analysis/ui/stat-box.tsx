import React from "react";
import { Paper, Typography, Box } from "@mui/material";

interface StatBoxProps {
  percentage: number;
  label: string;
  isHigh?: boolean;
  isMedium?: boolean;
  isHighlighted?: boolean;
}

export default function StatBox({ percentage, label, isHigh, isMedium, isHighlighted }: StatBoxProps) {
  const getBackgroundColor = () => {
    if (isHighlighted) return 'primary.main';
    if (isHigh) return 'success.dark';
    if (isMedium) return 'warning.dark';
    return 'error.dark';
  };

  return (
    <Paper sx={{ 
      p: 1, 
      textAlign: 'center', 
      bgcolor: getBackgroundColor(),
      border: isHighlighted ? 2 : 0,
      borderColor: 'primary.light'
    }}>
      <Typography variant="h6" fontWeight="bold" color="white">
        {percentage}%
      </Typography>
      <Typography variant="caption" color="grey.200" sx={{ fontSize: '0.7rem' }}>
        {label}
      </Typography>
    </Paper>
  );
}