/**
 * Sport Registry - Tüm spor adapter'ları tek yerden export eder
 * Sport selector UI'sı buradan besleniyor.
 */

import type { SportPlugin, SportId } from './_core/types';

import { footballPlugin } from './football';
import { hockeyPlugin } from './hockey';
import { basketballPlugin } from './basketball';
import { nbaPlugin } from './nba';
import { handballPlugin } from './handball';
import { americanFootballPlugin } from './americanFootball';
import { baseballPlugin } from './baseball';
import { volleyballPlugin } from './volleyball';
import { rugbyPlugin } from './rugby';
import { mmaPlugin } from './mma';
import { aflPlugin } from './afl';
import { formula1Plugin } from './formula1';

export const sportRegistry: Record<SportId, SportPlugin> = {
  football: footballPlugin,
  hockey: hockeyPlugin,
  basketball: basketballPlugin,
  nba: nbaPlugin,
  handball: handballPlugin,
  americanFootball: americanFootballPlugin,
  baseball: baseballPlugin,
  volleyball: volleyballPlugin,
  rugby: rugbyPlugin,
  mma: mmaPlugin,
  afl: aflPlugin,
  formula1: formula1Plugin,
};

export const allSports: SportPlugin[] = Object.values(sportRegistry);

export const popularSports: SportPlugin[] = [
  footballPlugin,
  basketballPlugin,
  hockeyPlugin,
  volleyballPlugin,
  handballPlugin,
  nbaPlugin,
  americanFootballPlugin,
  baseballPlugin,
];

export function getSport(id: SportId): SportPlugin {
  const plugin = sportRegistry[id];
  if (!plugin) throw new Error(`Unknown sport: ${id}`);
  return plugin;
}

export function getSportsList(): { id: SportId; name: string; nameTR: string; icon?: string }[] {
  return allSports.map(s => ({
    id: s.config.id,
    name: s.config.displayName,
    nameTR: s.config.displayNameTR,
  }));
}
