'use client';

import React from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { useTheme } from 'next-themes';
import { alpha } from '@mui/material/styles';

// Minimals.cc inspired theme configuration
const getTheme = (mode: 'light' | 'dark') =>
  createTheme({
    palette: {
      mode,
      ...(mode === 'light'
        ? {
            // Light theme colors (Minimals.cc style)
            primary: {
              main: '#007867',
              light: '#009688',
              dark: '#00695c',
              contrastText: '#ffffff',
            },
            secondary: {
              main: '#8e24aa',
              light: '#ba68c8',
              dark: '#7b1fa2',
              contrastText: '#ffffff',
            },
            background: {
              default: '#f9fafb',
              paper: '#ffffff',
            },
            text: {
              primary: '#212b36',
              secondary: '#637381',
            },
            grey: {
              50: '#f9fafb',
              100: '#f4f6f8',
              200: '#dfe3e8',
              300: '#c4cdd5',
              400: '#919eab',
              500: '#637381',
              600: '#454f5b',
              700: '#343a40',
              800: '#212b36',
              900: '#161c24',
            },
          }
        : {
            // Dark theme colors
            primary: {
              main: '#00ab55',
              light: '#5be584',
              dark: '#007b55',
              contrastText: '#ffffff',
            },
            secondary: {
              main: '#8e24aa',
              light: '#ba68c8',
              dark: '#7b1fa2',
              contrastText: '#ffffff',
            },
            background: {
              default: '#161c24',
              paper: '#212b36',
            },
            text: {
              primary: '#ffffff',
              secondary: '#919eab',
            },
            grey: {
              50: '#f9fafb',
              100: '#f4f6f8',
              200: '#dfe3e8',
              300: '#c4cdd5',
              400: '#919eab',
              500: '#637381',
              600: '#454f5b',
              700: '#343a40',
              800: '#212b36',
              900: '#161c24',
            },
          }),
    },
    typography: {
      fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
      h1: {
        fontWeight: 700,
        fontSize: '3rem',
        lineHeight: 1.25,
      },
      h2: {
        fontWeight: 700,
        fontSize: '2.25rem',
        lineHeight: 1.3,
      },
      h3: {
        fontWeight: 600,
        fontSize: '1.875rem',
        lineHeight: 1.4,
      },
      h4: {
        fontWeight: 600,
        fontSize: '1.5rem',
        lineHeight: 1.4,
      },
      h5: {
        fontWeight: 600,
        fontSize: '1.25rem',
        lineHeight: 1.5,
      },
      h6: {
        fontWeight: 600,
        fontSize: '1.125rem',
        lineHeight: 1.5,
      },
      body1: {
        fontSize: '0.875rem',
        lineHeight: 1.57,
      },
      body2: {
        fontSize: '0.8125rem',
        lineHeight: 1.54,
      },
    },
    shape: {
      borderRadius: 12,
    },
    components: {
      MuiCard: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 16,
            boxShadow: mode === 'light' 
              ? '0px 0px 2px rgba(145, 158, 171, 0.2), 0px 12px 24px -4px rgba(145, 158, 171, 0.12)'
              : '0px 0px 2px rgba(0, 0, 0, 0.2), 0px 12px 24px -4px rgba(0, 0, 0, 0.12)',
          }),
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            textTransform: 'none',
            fontWeight: 600,
            padding: '8px 16px',
          },
          contained: {
            boxShadow: 'none',
            '&:hover': {
              boxShadow: 'none',
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            fontWeight: 600,
          },
        },
      },
    },
  });

interface MuiThemeProviderProps {
  children: React.ReactNode;
}

export default function MuiThemeProvider({ children }: MuiThemeProviderProps) {
  const { theme: nextTheme } = useTheme();
  const muiTheme = getTheme(nextTheme === 'dark' ? 'dark' : 'light');

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}