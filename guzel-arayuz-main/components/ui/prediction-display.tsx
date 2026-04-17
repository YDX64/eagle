import React from "react";
import { Paper, Typography } from "@mui/material";

interface PredictionDisplayProps {
  value: string;
}

export default function PredictionDisplay({ value }: PredictionDisplayProps) {
  return (
    <Paper sx={{ 
      p: 2, 
      textAlign: 'center', 
      bgcolor: 'success.main', 
      mb: 2 
    }}>
      <Typography variant="h4" fontWeight="bold" color="white">
        {value}
      </Typography>
    </Paper>
  );
}