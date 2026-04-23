
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SPORTS = [
  { key: 'football', label: 'Futbol', icon: '\u26BD', href: '/', color: 'emerald' },
  { key: 'basketball', label: 'Basketbol', icon: '\uD83C\uDFC0', href: '/basketball', color: 'orange' },
  { key: 'nba', label: 'NBA', icon: '\uD83C\uDFC6', href: '/nba', color: 'indigo' },
  { key: 'hockey', label: 'Buz Hokeyi', icon: '\uD83C\uDFD2', href: '/hockey', color: 'blue' },
  { key: 'handball', label: 'Hentbol', icon: '\uD83E\uDD3E', href: '/handball', color: 'purple' },
  { key: 'volleyball', label: 'Voleybol', icon: '\uD83C\uDFD0', href: '/volleyball', color: 'pink' },
  { key: 'high-value', label: 'Yuksek Deger', icon: '\uD83D\uDCB0', href: '/high-value', color: 'yellow' },
] as const;

const TOOLS = [
  { key: 'bulk', label: 'Toplu Analiz', href: '/bulk-analysis' },
  { key: 'stats', label: 'Istatistikler', href: '/statistics' },
] as const;

const colorMap: Record<string, { active: string; hover: string; text: string }> = {
  emerald: { active: 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30', hover: 'hover:bg-emerald-100 dark:hover:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400' },
  orange: { active: 'bg-orange-600 text-white shadow-lg shadow-orange-500/30', hover: 'hover:bg-orange-100 dark:hover:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400' },
  indigo: { active: 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-500/30', hover: 'hover:bg-indigo-100 dark:hover:bg-indigo-900/30', text: 'text-indigo-700 dark:text-indigo-400' },
  blue: { active: 'bg-blue-600 text-white shadow-lg shadow-blue-500/30', hover: 'hover:bg-blue-100 dark:hover:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400' },
  purple: { active: 'bg-purple-600 text-white shadow-lg shadow-purple-500/30', hover: 'hover:bg-purple-100 dark:hover:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-400' },
  pink: { active: 'bg-pink-600 text-white shadow-lg shadow-pink-500/30', hover: 'hover:bg-pink-100 dark:hover:bg-pink-900/30', text: 'text-pink-700 dark:text-pink-400' },
  yellow: { active: 'bg-yellow-600 text-white shadow-lg shadow-yellow-500/30', hover: 'hover:bg-yellow-100 dark:hover:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400' },
};

export function SportSelector() {
  const pathname = usePathname();

  const getActiveSport = () => {
    if (pathname.startsWith('/nba')) return 'nba';
    if (pathname.startsWith('/basketball')) return 'basketball';
    if (pathname.startsWith('/hockey')) return 'hockey';
    if (pathname.startsWith('/handball')) return 'handball';
    if (pathname.startsWith('/volleyball')) return 'volleyball';
    if (pathname.startsWith('/high-value')) return 'high-value';
    if (pathname.startsWith('/bulk-analysis')) return 'bulk';
    if (pathname.startsWith('/statistics')) return 'stats';
    return 'football';
  };

  const activeSport = getActiveSport();

  return (
    <nav className="w-full overflow-x-auto scrollbar-hide">
      <div className="flex items-center gap-2 px-4 py-3 min-w-max">
        {SPORTS.map((sport) => {
          const isActive = activeSport === sport.key;
          const colors = colorMap[sport.color];
          return (
            <Link
              key={sport.key}
              href={sport.href}
              className={`
                flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm
                transition-all duration-200 whitespace-nowrap
                ${isActive
                  ? colors.active
                  : `bg-white/60 dark:bg-slate-800/60 ${colors.hover} ${colors.text} border border-slate-200/60 dark:border-slate-700/60`
                }
              `}
            >
              <span className="text-lg">{sport.icon}</span>
              <span>{sport.label}</span>
            </Link>
          );
        })}
        <span className="w-px h-6 bg-slate-300 dark:bg-slate-600 mx-1" />
        {TOOLS.map((tool) => {
          const isActive = activeSport === tool.key;
          return (
            <Link
              key={tool.key}
              href={tool.href}
              className={`
                flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium text-xs
                transition-all duration-200 whitespace-nowrap
                ${isActive
                  ? 'bg-slate-700 text-white shadow-md'
                  : 'bg-white/40 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-700/50 text-slate-600 dark:text-slate-400 border border-slate-200/40 dark:border-slate-700/40'
                }
              `}
            >
              <span>{tool.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
