"use client";

import React from "react";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";

const LegendContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: theme.spacing(3),
  padding: theme.spacing(1.5),
  backgroundColor: theme.palette.grey[800],
  borderRadius: theme.shape.borderRadius,
  flexWrap: 'wrap',
  [theme.breakpoints.down('sm')]: {
    gap: theme.spacing(2),
    justifyContent: 'flex-start',
  },
}));

const LegendItem = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(0.5),
}));

const ColorDot = styled(Box)<{ color: string }>(({ theme, color }) => ({
  width: 10,
  height: 10,
  borderRadius: '50%',
  backgroundColor: color,
  flexShrink: 0,
}));

export default function ColorLegend() {
  const legendItems = [
    { color: '#10B981', label: '80-100%: Safe', range: 'safe' },
    { color: '#F59E0B', label: '60-79%: Good', range: 'good' },
    { color: '#EF4444', label: '40-59%: Medium', range: 'medium' },
    { color: '#64748B', label: '0-39%: Low', range: 'low' },
  ];

  return (
    <LegendContainer>
      {legendItems.map((item, index) => (
        <LegendItem key={index}>
          <ColorDot color={item.color} />
          <Typography 
            variant="caption" 
            sx={{ 
              color: 'text.secondary',
              fontSize: '0.75rem',
              fontWeight: 500,
            }}
          >
            {item.label}
          </Typography>
        </LegendItem>
      ))}
    </LegendContainer>
  );
}