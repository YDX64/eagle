import React from "react";
import { Card, Box, Typography, Grid } from "@mui/material";
import { styled } from "@mui/material/styles";
import { CreditCard, CornerDownRight } from "lucide-react";

const PredictionCard = styled(Card)(({ theme }) => ({
  padding: theme.spacing(2),
  height: '100%',
}));

const StatBox = styled(Box)<{ percentage: number }>(({ theme, percentage }) => ({
  padding: theme.spacing(2),
  borderRadius: theme.shape.borderRadius,
  backgroundColor: 
    percentage >= 80 
      ? theme.palette.success.dark + '30'
      : percentage >= 60 
      ? theme.palette.warning.dark + '30'
      : theme.palette.error.dark + '30',
  border: `1px solid ${
    percentage >= 80 
      ? theme.palette.success.main
      : percentage >= 60 
      ? theme.palette.warning.main
      : theme.palette.error.main
  }`,
  textAlign: 'center',
}));

interface CardCornerPredictionProps {
  card: { prediction: string; value: number };
  corner: { prediction: string; value: number };
}

export default function CardCornerPrediction({ card, corner }: CardCornerPredictionProps) {
  return (
    <PredictionCard>
      <Grid container spacing={2} sx={{ height: '100%' }}>
        <Grid item xs={6}>
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <CreditCard size={18} style={{ marginRight: '8px', color: '#38BDF8' }} />
              <Typography variant="h6" fontWeight="bold" color="primary">
                CARDS
              </Typography>
            </Box>
            
            <StatBox percentage={card.value} sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <Typography variant="body2" sx={{ mb: 1, fontSize: '0.75rem' }}>
                {card.prediction}
              </Typography>
              <Typography variant="h4" fontWeight="bold" color={
                card.value >= 80 ? 'success.main' : 
                card.value >= 60 ? 'warning.main' : 'error.main'
              }>
                {card.value}%
              </Typography>
            </StatBox>
          </Box>
        </Grid>
        
        <Grid item xs={6}>
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <CornerDownRight size={18} style={{ marginRight: '8px', color: '#2DD4BF' }} />
              <Typography variant="h6" fontWeight="bold" color="secondary">
                CORNERS
              </Typography>
            </Box>
            
            <StatBox percentage={corner.value} sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <Typography variant="body2" sx={{ mb: 1, fontSize: '0.75rem' }}>
                {corner.prediction}
              </Typography>
              <Typography variant="h4" fontWeight="bold" color={
                corner.value >= 80 ? 'success.main' : 
                corner.value >= 60 ? 'warning.main' : 'error.main'
              }>
                {corner.value}%
              </Typography>
            </StatBox>
          </Box>
        </Grid>
      </Grid>
    </PredictionCard>
  );
}