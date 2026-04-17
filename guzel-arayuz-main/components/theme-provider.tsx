"use client";

import React from "react";
import { ThemeProvider as MUIThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { Inter, Roboto_Condensed } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const robotoCondensed = Roboto_Condensed({
  subsets: ["latin"],
  weight: ["700"],
  display: "swap",
  variable: "--font-roboto-condensed",
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = createTheme({
    palette: {
      mode: "dark",
      primary: {
        main: "#38BDF8",
        light: "#67E8F9",
        dark: "#0B6A99",
      },
      secondary: {
        main: "#2DD4BF",
        light: "#5EEAD4",
        dark: "#0F766E",
      },
      background: {
        default: "#0F172A",
        paper: "#1E293B",
      },
      success: {
        main: "#10B981",
        light: "#34D399",
        dark: "#059669",
      },
      warning: {
        main: "#F59E0B",
        light: "#FBBF24",
        dark: "#D97706",
      },
      error: {
        main: "#EF4444",
        light: "#F87171",
        dark: "#DC2626",
      },
      grey: {
        50: "#F8FAFC",
        100: "#F1F5F9",
        200: "#E2E8F0",
        300: "#CBD5E1",
        400: "#94A3B8",
        500: "#64748B",
        600: "#475569",
        700: "#334155",
        800: "#1E293B",
        900: "#0F172A",
      },
      text: {
        primary: "#E2E8F0",
        secondary: "#94A3B8",
      },
    },
    typography: {
      fontFamily: inter.style.fontFamily,
      h1: {
        fontFamily: robotoCondensed.style.fontFamily,
        letterSpacing: "0.1em",
      },
      h2: {
        fontFamily: robotoCondensed.style.fontFamily,
        letterSpacing: "0.05em",
      },
      h3: {
        fontFamily: robotoCondensed.style.fontFamily,
        letterSpacing: "0.05em",
      },
      h4: {
        fontFamily: robotoCondensed.style.fontFamily,
      },
      h5: {
        fontFamily: robotoCondensed.style.fontFamily,
      },
      h6: {
        fontFamily: robotoCondensed.style.fontFamily,
      },
    },
    shape: {
      borderRadius: 4,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: "#0F172A",
            color: "#E2E8F0",
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: "#1E293B",
            borderRadius: 6,
            border: "1px solid #334155",
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
            borderRadius: 4,
          },
        },
      },
    },
  });

  return (
    <MUIThemeProvider theme={theme}>
      <CssBaseline />
      <div className={`${inter.variable} ${robotoCondensed.variable}`}>
        {children}
      </div>
    </MUIThemeProvider>
  );
}