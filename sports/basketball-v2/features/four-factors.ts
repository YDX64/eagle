/**
 * Dean Oliver's Four Factors
 *
 * The four factors that win basketball games (and their relative weights
 * from Oliver's research):
 *
 *   1. Shooting (40%):         eFG% = (FGM + 0.5 * 3PM) / FGA
 *   2. Turnovers (25%):        TOV% = TOV / (FGA + 0.44 * FTA + TOV)
 *   3. Rebounding (20%):       ORB% = OREB / (OREB + opponent DREB)
 *   4. Free Throws (15%):      FT Rate = FTM / FGA  (or FTA/FGA per some defs)
 *
 * A team's four factors + opponent's four factors together describe nearly
 * all of the point differential in basketball. This makes them the ideal
 * features for a prediction model.
 */

export interface FourFactorInputs {
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  tpm: number;       // 3-pointers made
  offReb: number;
  oppDefReb: number; // opponent defensive rebounds (for ORB% denominator)
  turnovers: number;
}

export interface FourFactors {
  efgPct: number;
  tovPct: number;
  orbPct: number;
  ftRate: number;
  // Weighted composite score (higher = better offense)
  // Dean Oliver's weight: 0.4*eFG + 0.25*(1-TOV) + 0.20*ORB + 0.15*FT
  compositeOffense: number;
}

/**
 * Compute Four Factors from raw totals.
 */
export function computeFourFactors(input: FourFactorInputs): FourFactors | null {
  if (input.fga <= 0) return null;

  const efgPct = (input.fgm + 0.5 * input.tpm) / input.fga;

  const tovDenom = input.fga + 0.44 * input.fta + input.turnovers;
  const tovPct = tovDenom > 0 ? input.turnovers / tovDenom : 0;

  const orbDenom = input.offReb + input.oppDefReb;
  const orbPct = orbDenom > 0 ? input.offReb / orbDenom : 0;

  const ftRate = input.fga > 0 ? input.ftm / input.fga : 0;

  const compositeOffense =
    0.4 * efgPct + 0.25 * (1 - tovPct) + 0.2 * orbPct + 0.15 * ftRate;

  return { efgPct, tovPct, orbPct, ftRate, compositeOffense };
}

/**
 * Compute defensive composite: how good is a team at limiting the opponent's
 * four factors. Higher = better defense.
 */
export function computeDefensiveComposite(opp: FourFactors): number {
  return (
    0.4 * (1 - opp.efgPct) + 0.25 * opp.tovPct + 0.2 * (1 - opp.orbPct) + 0.15 * (1 - opp.ftRate)
  );
}

/**
 * Build feature vector for ML model from a team's Four Factors + opponent's.
 */
export function buildFourFactorFeatureVector(
  teamOffense: FourFactors | null,
  teamDefense: FourFactors | null,  // opponent's Four Factors when team was defending
  oppOffense: FourFactors | null,
  oppDefense: FourFactors | null
): number[] {
  const tOff = teamOffense ?? { efgPct: 0.5, tovPct: 0.14, orbPct: 0.26, ftRate: 0.2, compositeOffense: 0.5 };
  const tDef = teamDefense ?? { efgPct: 0.5, tovPct: 0.14, orbPct: 0.26, ftRate: 0.2, compositeOffense: 0.5 };
  const oOff = oppOffense ?? { efgPct: 0.5, tovPct: 0.14, orbPct: 0.26, ftRate: 0.2, compositeOffense: 0.5 };
  const oDef = oppDefense ?? { efgPct: 0.5, tovPct: 0.14, orbPct: 0.26, ftRate: 0.2, compositeOffense: 0.5 };

  return [
    // Team offense
    tOff.efgPct, tOff.tovPct, tOff.orbPct, tOff.ftRate, tOff.compositeOffense,
    // Team defense (what opponents do against us)
    tDef.efgPct, tDef.tovPct, tDef.orbPct, tDef.ftRate,
    // Opponent offense
    oOff.efgPct, oOff.tovPct, oOff.orbPct, oOff.ftRate, oOff.compositeOffense,
    // Opponent defense
    oDef.efgPct, oDef.tovPct, oDef.orbPct, oDef.ftRate,
    // Matchup differentials
    tOff.efgPct - oDef.efgPct,
    tOff.tovPct - oDef.tovPct,
    tOff.orbPct - oDef.orbPct,
    tOff.ftRate - oDef.ftRate,
  ];
}
