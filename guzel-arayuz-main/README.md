# Betting Prediction Component

A beautiful, production-ready betting prediction component built with Next.js 15, Material-UI, and TypeScript.

## Features

- 🏈 Match header with team logos and form indicators
- 📊 First half and full-time predictions with odds
- 🎯 Banker and card/corner predictions
- 📱 Fully responsive design
- 🎨 Dark theme with beautiful gradients
- 🔄 Easy to integrate and customize

## Integration Guide

### 1. Install Dependencies

```bash
npm install @emotion/react @emotion/styled @mui/material lucide-react next@15 react@18 react-dom@18
```

### 2. Copy Required Files

Copy these files to your Next.js project:

```
components/
├── betting-prediction.tsx          # Main component
├── match-header.tsx               # Match header
├── prediction-grid.tsx            # Prediction layout
├── theme-provider.tsx             # MUI theme
├── predictions/
│   ├── first-half-prediction.tsx
│   ├── full-time-prediction.tsx
│   └── special-predictions.tsx
└── ui/
    ├── section-title.tsx
    ├── score-display.tsx
    ├── odds-box.tsx
    ├── prediction-display.tsx
    ├── stat-box.tsx
    ├── banko-prediction.tsx
    ├── card-corner-prediction.tsx
    └── color-legend.tsx
```

### 3. Add Theme Provider

Wrap your app with the theme provider:

```tsx
// app/layout.tsx or pages/_app.tsx
import { ThemeProvider } from "@/components/theme-provider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

### 4. Use the Component

```tsx
// app/page.tsx or any page
import BettingPrediction from "@/components/betting-prediction";

export default function Page() {
  return <BettingPrediction />;
}
```

### 5. Customize Data

Modify the `matchData` object in `betting-prediction.tsx` to use your own data:

```tsx
const matchData = {
  league: "YOUR LEAGUE",
  date: "YOUR DATE",
  time: "YOUR TIME", 
  homeTeam: {
    name: "Home Team",
    logo: "https://your-logo-url.com",
    position: "1st",
    form: ["win", "win", "draw", "win", "loss"],
  },
  awayTeam: {
    name: "Away Team", 
    logo: "https://your-logo-url.com",
    position: "2nd",
    form: ["win", "loss", "win", "draw", "win"],
  },
  predictions: {
    // Your prediction data
  }
};
```

## API Integration

Replace the static `matchData` with API calls:

```tsx
import { useEffect, useState } from 'react';

export default function BettingPrediction() {
  const [matchData, setMatchData] = useState(null);

  useEffect(() => {
    fetch('/api/match-predictions')
      .then(res => res.json())
      .then(setMatchData);
  }, []);

  if (!matchData) return <div>Loading...</div>;

  return (
    // Component JSX
  );
}
```

## Customization

- **Colors**: Modify the theme in `theme-provider.tsx`
- **Layout**: Adjust the grid system in `prediction-grid.tsx`  
- **Data Structure**: Update TypeScript interfaces for your data format
- **Styling**: All components use Material-UI's styled system

## TypeScript Support

Full TypeScript support with proper interfaces for all data structures.

## Responsive Design

Works perfectly on all screen sizes from mobile to desktop.