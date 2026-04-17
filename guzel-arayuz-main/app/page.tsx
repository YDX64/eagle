"use client";

import { ThemeProvider } from "@/components/theme-provider";
import BettingPrediction from "@/components/betting-prediction";

export default function Home() {
  return (
    <ThemeProvider>
      <BettingPrediction />
    </ThemeProvider>
  );
}