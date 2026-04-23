import React from "react";
import { Box, Typography } from "@mui/material";

interface SectionTitleProps {
  icon: React.ReactNode;
  title: string;
}

export default function SectionTitle({ icon, title }: SectionTitleProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
      {icon}
      <Typography variant="h6" fontWeight="bold" color="primary.light">
        {title}
      </Typography>
    </Box>
  );
}