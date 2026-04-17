import React from "react";
import { Card, Box, Typography, Chip } from "@mui/material";
import { styled } from "@mui/material/styles";
import { Target } from "lucide-react";

const BankoCard = styled(Card)(({ theme }) => ({
  padding: theme.spacing(3),
  background: `linear-gradient(135deg, ${theme.palette.success.dark}20 0%, ${theme.palette.success.main}10 100%)`,
  border: `2px solid ${theme.palette.success.main}`,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
}));

const PercentageText = styled(Typography)(({ theme }) => ({
  fontSize: '3.5rem',
  fontWeight: 'bold',
  color: theme.palette.success.main,
  lineHeight: 1,
}));

interface BankoPredictionProps {
  value: number;
  prediction: string;
  source: string;
}

export default function BankoPrediction({ value, prediction, source }: BankoPredictionProps) {
  return (
    <BankoCard>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Target size={24} style={{ color: '#10B981', marginRight: '8px' }} />
        <Typography variant="h6" fontWeight="bold" color="success.main">
          BANKER
        </Typography>
      </Box>
      
      <PercentageText>{value}%</PercentageText>
      
      <Typography 
        variant="h6" 
        fontWeight="bold" 
        sx={{ 
          mt: 2, 
          mb: 1, 
          color: 'success.light',
          textAlign: 'center'
        }}
      >
        {prediction}
      </Typography>
      
      <Chip 
        label={`@ ${source}`}
        size="small"
        sx={{ 
          bgcolor: 'success.main',
          color: 'white',
          fontSize: '0.75rem'
        }}
      />
    </BankoCard>
  );
}