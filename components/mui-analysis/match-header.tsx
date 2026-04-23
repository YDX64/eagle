"use client";

import React from "react";
import { Box, Typography, Paper, Stack, Chip } from "@mui/material";
import { styled } from "@mui/material/styles";
import { Calendar, Clock } from "lucide-react";

// Types
interface TeamFormIndicator {
  win: string;
  loss: string;
  draw: string;
}

interface MatchHeaderProps {
  matchData: {
    league: string;
    date: string;
    time: string;
    homeTeam: {
      name: string;
      logo: string;
      position: string;
      form: string[];
    };
    awayTeam: {
      name: string;
      logo: string;
      position: string;
      form: string[];
    };
  };
}

// Styled components
const TeamBar = styled(Paper)(({ theme }) => ({
  backgroundColor: theme.palette.primary.dark,
  borderRadius: theme.shape.borderRadius * 2,
  padding: theme.spacing(2, 4),
  display: 'grid',
  gridTemplateColumns: '1fr min-content 1fr',
  alignItems: 'center',
  width: '100%'
}));

const FormDot = styled(Box)<{ status: string }>(({ theme, status }) => ({
  width: 10,
  height: 10,
  borderRadius: '50%',
  display: 'inline-block',
  marginRight: 4,
  backgroundColor:
    status === 'win'
      ? theme.palette.success.main
      : status === 'loss'
      ? theme.palette.error.main
      : theme.palette.warning.main,
}));

export default function MatchHeader({ matchData }: MatchHeaderProps) {
  const formColors: TeamFormIndicator = {
    win: "success",
    loss: "error",
    draw: "warning",
  };

  return (
    <Box
      sx={{
        p: { xs: 1.5, sm: 2, md: 3 },
        textAlign: "center",
        bgcolor: "grey.900",
        borderBottom: 1,
        borderColor: "grey.700",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
        <Typography
          variant="h6"
          component="div"
          sx={{
            fontFamily: "var(--font-roboto-condensed)",
            letterSpacing: "0.1em",
            color: "primary.light",
            textTransform: "uppercase",
          }}
        >
          {matchData.league}
        </Typography>
        
        <Box sx={{ display: "flex", alignItems: "center", color: "text.secondary" }}>
          <Calendar size={14} />
          <Typography variant="body2" sx={{ mx: 1 }}>
            {matchData.date}
          </Typography>
          <Clock size={14} />
          <Typography variant="body2" sx={{ ml: 1 }}>
            {matchData.time}
          </Typography>
        </Box>
      </Box>

      <TeamBar>
        <Stack alignItems="center" spacing={0.5}>
          <Box
            component="img"
            src={matchData.homeTeam.logo}
            alt={`${matchData.homeTeam.name} logo`}
            sx={{
              width: 40,
              height: 40,
              objectFit: "contain",
              mb: 0.5,
            }}
          />
          <Typography variant="body1" fontWeight="bold" color="white">
            {matchData.homeTeam.name}
          </Typography>
          <Typography variant="caption" fontWeight="semibold" color="grey.300">
            {matchData.homeTeam.position}
          </Typography>
          <Box sx={{ display: "flex", mt: 0.5 }}>
            {matchData.homeTeam.form.map((result, index) => (
              <FormDot key={index} status={result} />
            ))}
          </Box>
        </Stack>

        <Typography
          variant="h4"
          component="div"
          fontWeight="bold"
          color="white"
          sx={{ 
            px: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          VS
        </Typography>

        <Stack alignItems="center" spacing={0.5}>
          <Box
            component="img"
            src={matchData.awayTeam.logo}
            alt={`${matchData.awayTeam.name} logo`}
            sx={{
              width: 40,
              height: 40,
              objectFit: "contain",
              mb: 0.5,
            }}
          />
          <Typography variant="body1" fontWeight="bold" color="white">
            {matchData.awayTeam.name}
          </Typography>
          <Typography variant="caption" fontWeight="semibold" color="grey.300">
            {matchData.awayTeam.position}
          </Typography>
          <Box sx={{ display: "flex", mt: 0.5 }}>
            {matchData.awayTeam.form.map((result, index) => (
              <FormDot key={index} status={result} />
            ))}
          </Box>
        </Stack>
      </TeamBar>
    </Box>
  );
}