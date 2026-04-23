'use client';

import { CssBaseline } from '@mui/material';
import {
  StyledEngineProvider,
  ThemeProvider,
  createTheme,
  type ThemeOptions,
} from '@mui/material/styles';
import { Inter, Roboto_Condensed } from 'next/font/google';
import { useMemo, type ReactNode } from 'react';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const robotoCondensed = Roboto_Condensed({
  subsets: ['latin'],
  weight: ['300', '400', '700'],
  display: 'swap',
  variable: '--font-roboto-condensed',
});

const themeOptions: ThemeOptions = {
  palette: {
    mode: 'dark',
    primary: {
      main: '#38BDF8',
      light: '#7DD3FC',
      dark: '#0EA5E9',
      contrastText: '#0F172A',
    },
    secondary: {
      main: '#2DD4BF',
      light: '#5EEAD4',
      dark: '#0F766E',
      contrastText: '#0F172A',
    },
    background: {
      default: '#0F172A',
      paper: '#1E293B',
    },
    divider: 'rgba(148, 163, 184, 0.18)',
    text: {
      primary: '#E2E8F0',
      secondary: '#94A3B8',
      disabled: 'rgba(148, 163, 184, 0.38)',
    },
    success: {
      main: '#34D399',
      contrastText: '#0F172A',
    },
    warning: {
      main: '#F59E0B',
      contrastText: '#0F172A',
    },
    error: {
      main: '#F43F5E',
      contrastText: '#0F172A',
    },
    info: {
      main: '#38BDF8',
      contrastText: '#0F172A',
    },
  },
  typography: {
    fontFamily:
      "var(--font-inter), 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 14,
    h1: {
      fontFamily:
        "var(--font-roboto-condensed), 'Roboto Condensed', 'Inter', sans-serif",
      fontWeight: 700,
      fontSize: '3rem',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    },
    h2: {
      fontFamily:
        "var(--font-roboto-condensed), 'Roboto Condensed', 'Inter', sans-serif",
      fontWeight: 700,
      fontSize: '2.25rem',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    },
    h3: {
      fontFamily:
        "var(--font-roboto-condensed), 'Roboto Condensed', 'Inter', sans-serif",
      fontWeight: 600,
      fontSize: '1.75rem',
      letterSpacing: '0.04em',
    },
    h4: {
      fontFamily:
        "var(--font-roboto-condensed), 'Roboto Condensed', 'Inter', sans-serif",
      fontWeight: 600,
      fontSize: '1.5rem',
      letterSpacing: '0.02em',
    },
    h5: {
      fontFamily:
        "var(--font-roboto-condensed), 'Roboto Condensed', 'Inter', sans-serif",
      fontWeight: 600,
      fontSize: '1.25rem',
      letterSpacing: '0.02em',
    },
    h6: {
      fontFamily:
        "var(--font-roboto-condensed), 'Roboto Condensed', 'Inter', sans-serif",
      fontWeight: 600,
      fontSize: '1.1rem',
      letterSpacing: '0.02em',
    },
    subtitle1: {
      fontWeight: 500,
      letterSpacing: '0.02em',
    },
    subtitle2: {
      fontWeight: 500,
      letterSpacing: '0.02em',
    },
    body1: {
      fontWeight: 400,
      letterSpacing: '0.01em',
    },
    body2: {
      fontWeight: 400,
      letterSpacing: '0.01em',
    },
    button: {
      fontWeight: 600,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
    },
    overline: {
      fontWeight: 600,
      letterSpacing: '0.16em',
    },
  },
  shape: {
    borderRadius: 16,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#0F172A',
          color: '#E2E8F0',
          fontFamily:
            "var(--font-inter), 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
        '*::-webkit-scrollbar': {
          width: 8,
          height: 8,
        },
        '*::-webkit-scrollbar-thumb': {
          backgroundColor: 'rgba(148, 163, 184, 0.4)',
          borderRadius: 999,
        },
        '*::-webkit-scrollbar-track': {
          backgroundColor: 'rgba(15, 23, 42, 0.8)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: '#111827',
          borderRadius: 20,
          border: '1px solid rgba(148, 163, 184, 0.12)',
          boxShadow:
            '0 20px 45px rgba(15, 23, 42, 0.65), 0 1px 0 rgba(148, 163, 184, 0.08)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: '#1E293B',
          borderRadius: 24,
          border: '1px solid rgba(148, 163, 184, 0.08)',
          boxShadow:
            '0 18px 40px rgba(15, 23, 42, 0.45), 0 1px 0 rgba(148, 163, 184, 0.05)',
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          borderRadius: 999,
          textTransform: 'none',
          fontWeight: 600,
          padding: '0.65rem 1.5rem',
        },
        containedPrimary: {
          boxShadow: '0 16px 35px rgba(56, 189, 248, 0.35)',
        },
        containedSecondary: {
          boxShadow: '0 16px 30px rgba(45, 212, 191, 0.35)',
          color: '#0F172A',
        },
        outlined: {
          borderColor: 'rgba(148, 163, 184, 0.4)',
          '&:hover': {
            borderColor: '#38BDF8',
            backgroundColor: 'rgba(56, 189, 248, 0.08)',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          backgroundColor: 'rgba(148, 163, 184, 0.16)',
          border: '1px solid rgba(148, 163, 184, 0.24)',
          color: '#E2E8F0',
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          letterSpacing: '0.04em',
          minHeight: 48,
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: {
          height: 4,
          borderRadius: 999,
          backgroundColor: '#38BDF8',
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: 'rgba(148, 163, 184, 0.12)',
        },
      },
    },
    MuiListItem: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          transition: 'background-color 120ms ease, transform 160ms ease',
          '&:hover': {
            backgroundColor: 'rgba(148, 163, 184, 0.12)',
            transform: 'translateY(-1px)',
          },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#1F2937',
          borderRadius: 12,
          padding: '0.5rem 0.75rem',
          fontSize: '0.75rem',
        },
        arrow: {
          color: '#1F2937',
        },
      },
    },
  },
};

type MuiAnalysisThemeProviderProps = {
  children: ReactNode;
};

export function MuiAnalysisThemeProvider({
  children,
}: MuiAnalysisThemeProviderProps) {
  const theme = useMemo(() => createTheme(themeOptions), []);

  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <div className={`${inter.variable} ${robotoCondensed.variable}`}>
          {children}
        </div>
      </ThemeProvider>
    </StyledEngineProvider>
  );
}

export default MuiAnalysisThemeProvider;
