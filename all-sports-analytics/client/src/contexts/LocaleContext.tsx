/**
 * AWA Stats - Locale Context
 * Dil yönetimi için React Context
 */
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { type Locale, type TranslationKey, detectLocale, saveLocale, t } from '@/lib/i18n';

interface LocaleContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
}

const LocaleContext = createContext<LocaleContextType | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale());

  const handleSetLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    saveLocale(newLocale);
    document.documentElement.lang = newLocale;
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const translate = (key: TranslationKey) => t(locale, key);

  return (
    <LocaleContext.Provider value={{ locale, setLocale: handleSetLocale, t: translate }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}
