/**
 * AWA Stats - Language Switcher Component
 * Bayraklı dil seçici - üst bar için
 */
import { useState, useRef, useEffect } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { LOCALES, type Locale } from '@/lib/i18n';
import { ChevronDown } from 'lucide-react';

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = LOCALES.find(l => l.code === locale) || LOCALES[2];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/40 hover:bg-accent/60 border border-border/30 transition-all text-sm"
      >
        <img
          src={current.flagUrl}
          alt={current.nativeName}
          className="w-5 h-4 object-cover rounded-sm"
        />
        <span className="text-xs font-medium hidden sm:inline">{current.nativeName}</span>
        <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] glass-card rounded-lg border border-border/40 shadow-xl overflow-hidden">
          {LOCALES.map((loc) => (
            <button
              key={loc.code}
              onClick={() => {
                setLocale(loc.code as Locale);
                setOpen(false);
              }}
              className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors ${
                locale === loc.code
                  ? 'bg-ice/10 text-ice'
                  : 'hover:bg-accent/40 text-foreground'
              }`}
            >
              <img
                src={loc.flagUrl}
                alt={loc.nativeName}
                className="w-6 h-4 object-cover rounded-sm"
              />
              <span className="font-medium">{loc.nativeName}</span>
              {locale === loc.code && (
                <span className="ml-auto w-2 h-2 rounded-full bg-ice" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
