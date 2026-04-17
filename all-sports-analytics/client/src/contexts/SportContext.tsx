/**
 * Sport Context - Current selected sport
 * Used across all pages to know which sport's data to show
 */

import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import type { SportId } from '../sports/_core/types';
import { getSport } from '../sports/registry';
import type { SportPlugin } from '../sports/_core/types';

interface SportContextValue {
  currentSport: SportId;
  setCurrentSport: (id: SportId) => void;
  plugin: SportPlugin;
  // All sports mode for bulk analysis
  allSportsMode: boolean;
  setAllSportsMode: (on: boolean) => void;
}

const SportContext = createContext<SportContextValue | null>(null);

const STORAGE_KEY = 'asa_current_sport';

export function SportProvider({ children }: { children: ReactNode }) {
  const [currentSport, setCurrentSportState] = useState<SportId>('football');
  const [allSportsMode, setAllSportsMode] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setCurrentSportState(saved as SportId);
  }, []);

  const setCurrentSport = (id: SportId) => {
    setCurrentSportState(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  const plugin = getSport(currentSport);

  return (
    <SportContext.Provider value={{ currentSport, setCurrentSport, plugin, allSportsMode, setAllSportsMode }}>
      {children}
    </SportContext.Provider>
  );
}

export function useSport() {
  const ctx = useContext(SportContext);
  if (!ctx) throw new Error('useSport must be used within SportProvider');
  return ctx;
}
