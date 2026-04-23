#!/usr/bin/env python3
"""
Validate built-in odds patterns against historical Pinnacle/Bet365 database.

GOAL: Her built-in pattern (lib/probet/odds-patterns.ts içindeki BUILTIN_PATTERNS)
için historical DB'de empirical hit rate hesapla. Çıktı:
  lib/probet/odds-pattern-calibration.json

  {
    "patterns": {
      "htft_2_1_classic": {
        "hitRate": 0.062,
        "sampleSize": 1245,
        "isBanko": false,
        "lift": 2.4
      },
      "btts_lock_o25_144": {
        "hitRate": 0.78,
        "sampleSize": 8234,
        "isBanko": true,
        "lift": 1.5
      },
      ...
    },
    "base_rates": {...}
  }

Pattern conditions are TypeScript objects so we mirror them in Python.
The pattern definitions here MUST match BUILTIN_PATTERNS in odds-patterns.ts.
"""

import sqlite3
import json
from pathlib import Path
from datetime import datetime

DB_PATH = Path(__file__).parent.parent / 'data' / 'odds.db'
OUT_FILE = Path(__file__).parent.parent / 'lib' / 'probet' / 'odds-pattern-calibration.json'

# Min sample size for a pattern to be marked banko-eligible
BANKO_MIN_SAMPLE = 500
BANKO_MIN_RATE = 0.65


def safe_float(s):
    if not s:
        return None
    try:
        v = float(s)
        return v if v > 1.01 else None
    except (ValueError, TypeError):
        return None


# Mirror of BUILTIN_PATTERNS from odds-patterns.ts.
# Each pattern: (id, conditions_lambda, outcome_lambda)
# - conditions: dict of (market_name → min, max, drift)
# - outcome: lambda(home, away, fhalf) → bool
def parse_halftime(fhalf):
    if not fhalf or ':' not in fhalf:
        return None, None
    try:
        h, a = fhalf.split(':')
        return int(h), int(a)
    except (ValueError, TypeError):
        return None, None


def out_home_win(h, a, fh):
    return h > a


def out_draw(h, a, fh):
    return h == a


def out_away_win(h, a, fh):
    return h < a


def out_dc_1x(h, a, fh):
    return h >= a


def out_dc_x2(h, a, fh):
    return h <= a


def out_over_05(h, a, fh):
    return (h + a) >= 1


def out_over_15(h, a, fh):
    return (h + a) >= 2


def out_over_25(h, a, fh):
    return (h + a) >= 3


def out_over_35(h, a, fh):
    return (h + a) >= 4


def out_under_15(h, a, fh):
    return (h + a) < 2


def out_under_25(h, a, fh):
    return (h + a) < 3


def out_btts_yes(h, a, fh):
    return h > 0 and a > 0


def out_btts_no(h, a, fh):
    return not (h > 0 and a > 0)


def out_ht_over_05(h, a, fh):
    h_ht, a_ht = parse_halftime(fh)
    if h_ht is None:
        return None
    return (h_ht + a_ht) >= 1


def out_ht_over_15(h, a, fh):
    h_ht, a_ht = parse_halftime(fh)
    if h_ht is None:
        return None
    return (h_ht + a_ht) >= 2


def out_ht_under_15(h, a, fh):
    h_ht, a_ht = parse_halftime(fh)
    if h_ht is None:
        return None
    return (h_ht + a_ht) < 2


def make_htft_outcome(ht_side, ft_side):
    def out(h, a, fh):
        h_ht, a_ht = parse_halftime(fh)
        if h_ht is None:
            return None
        actual_ht = 'H' if h_ht > a_ht else 'A' if h_ht < a_ht else 'D'
        actual_ft = 'H' if h > a else 'A' if h < a else 'D'
        return actual_ht == ht_side and actual_ft == ft_side
    return out


# Pattern conditions: (column_name, min, max)
# market name → DB column for closing odds
COL_MAP = {
    'MS1_CLOSE': 'c_ft1_18',
    'MSX_CLOSE': 'c_ftx_18',
    'MS2_CLOSE': 'c_ft2_18',
    'DC_1X_CLOSE': 'c_dc1x_18',
    'DC_12_CLOSE': 'c_dc12_18',
    'DC_X2_CLOSE': 'c_dcx2_18',
    'OVER_05_CLOSE': 'c_fto05_18',
    'UNDER_05_CLOSE': 'c_ftu05_18',
    'OVER_15_CLOSE': 'c_fto15_18',
    'UNDER_15_CLOSE': 'c_ftu15_18',
    'OVER_25_CLOSE': 'c_fto25_18',
    'UNDER_25_CLOSE': 'c_ftu25_18',
    'OVER_35_CLOSE': 'c_fto35_18',
    'UNDER_35_CLOSE': 'c_ftu35_18',
    'OVER_45_CLOSE': 'c_fto45_18',
    'BTTS_YES_CLOSE': 'c_btts1_18',
    'BTTS_NO_CLOSE': 'c_btts2_18',
    'HT_05_OVER_CLOSE': 'c_sto05_18',
    'HT_05_UNDER_CLOSE': 'c_stu05_18',
    'HT_15_OVER_CLOSE': 'c_sto15_18',
    'HT_15_UNDER_CLOSE': 'c_stu15_18',
    'HT_MS1_CLOSE': 'c_st1_18',
    'HT_MSX_CLOSE': 'c_stx_18',
    'HT_MS2_CLOSE': 'c_st2_18',
}


# Patterns mirror odds-patterns.ts BUILTIN_PATTERNS.
# Each entry: id, list of (market, min, max), outcome_fn, expected_rate
PATTERNS = [
    # GROUP 1: User core patterns
    ('htft_2_1_classic', [
        ('MS1_CLOSE', 1.4, 2.75),
        ('OVER_25_CLOSE', None, 2.05),
        ('BTTS_YES_CLOSE', None, 1.95),
    ], make_htft_outcome('A', 'H'), 0.065),

    ('btts_lock_o25_144', [
        ('OVER_25_CLOSE', 1.4, 1.48),
    ], out_btts_yes, 0.76),

    ('ms1_160_169_btts', [
        ('MS1_CLOSE', 1.6, 1.69),
    ], out_btts_yes, 0.5152),

    ('ms1_220_home', [
        ('MS1_CLOSE', 2.15, 2.30),
    ], out_home_win, 0.48),

    ('msx_433_iy_gol', [
        ('MSX_CLOSE', 4.15, 4.55),
    ], out_ht_over_05, 0.7431),

    ('goal_stack_filter', [
        ('HT_15_OVER_CLOSE', None, 2.15),
        ('HT_05_OVER_CLOSE', None, 1.30),
        ('DC_1X_CLOSE', None, 1.35),
        ('BTTS_YES_CLOSE', None, 1.85),
    ], out_over_15, 0.92),

    ('footystats_btts_stack', [
        ('BTTS_YES_CLOSE', None, 1.85),
        ('OVER_25_CLOSE', None, 1.70),
        ('OVER_15_CLOSE', None, 1.35),
    ], out_btts_yes, 0.78),

    # GROUP 2: Literature/bookmaker wisdom
    ('draw_low_goals', [
        ('MSX_CLOSE', None, 3.50),
        ('OVER_25_CLOSE', 2.20, None),
    ], out_draw, 0.38),

    ('over_35_lock', [
        ('OVER_35_CLOSE', 1.80, 2.10),
        ('BTTS_YES_CLOSE', None, 1.85),
    ], out_over_35, 0.56),

    ('underdog_win_value', [
        ('MS2_CLOSE', 5.0, 8.0),
        ('MSX_CLOSE', None, 3.30),
    ], out_away_win, 0.18),

    ('strong_fav_home', [
        ('MS1_CLOSE', None, 1.50),
        ('OVER_15_CLOSE', None, 1.30),
    ], out_home_win, 0.72),

    ('defensive_match', [
        ('OVER_25_CLOSE', 2.35, None),
        ('BTTS_YES_CLOSE', 2.10, None),
    ], out_under_25, 0.58),

    ('high_scoring_lock', [
        ('OVER_15_CLOSE', None, 1.20),
        ('OVER_25_CLOSE', None, 1.65),
    ], out_over_15, 0.94),

    ('dc_x2_safe', [
        ('DC_X2_CLOSE', None, 1.35),
        ('OVER_25_CLOSE', None, 1.85),
    ], out_dc_x2, 0.78),

    ('btts_no_defensive', [
        ('BTTS_NO_CLOSE', None, 1.75),
        ('OVER_25_CLOSE', 2.20, None),
    ], out_btts_no, 0.62),

    # GROUP 3: Super Banko
    ('super_banko_over_05', [
        ('OVER_05_CLOSE', 1.01, 1.10),
        ('UNDER_15_CLOSE', 2.20, 3.50),
    ], out_over_05, 0.973),

    ('super_banko_ms1x', [
        ('DC_1X_CLOSE', 1.20, 1.30),
        ('MS2_CLOSE', 3.80, 5.50),
    ], out_dc_1x, 0.948),

    ('super_banko_ms2x', [
        ('DC_X2_CLOSE', 1.25, 1.35),
        ('MS1_CLOSE', 3.50, 5.0),
    ], out_dc_x2, 0.935),

    ('super_banko_btts_no', [
        ('BTTS_NO_CLOSE', 1.50, 1.70),
        ('OVER_25_CLOSE', 2.20, 2.80),
    ], out_btts_no, 0.912),

    ('low_scoring_match', [
        ('OVER_25_CLOSE', 2.50, 3.20),
        ('BTTS_NO_CLOSE', 1.50, 1.70),
    ], out_under_25, 0.897),

    ('strong_favorite_win', [
        ('MS1_CLOSE', 1.20, 1.40),
        ('DC_1X_CLOSE', 1.05, 1.15),
    ], out_home_win, 0.923),

    # GROUP 4: HTFT
    ('htft_1_1_lock', [
        ('MS1_CLOSE', 1.45, 1.80),
        ('HT_15_UNDER_CLOSE', 1.40, 1.70),
    ], make_htft_outcome('H', 'H'), 0.835),

    ('htft_x_1_classic', [
        ('HT_MSX_CLOSE', 1.80, 2.30),
        ('MS1_CLOSE', 1.60, 2.10),
    ], make_htft_outcome('D', 'H'), 0.742),

    ('htft_x_x_draw', [
        ('MSX_CLOSE', 3.0, 3.5),
        ('OVER_25_CLOSE', 2.20, None),
    ], make_htft_outcome('D', 'D'), 0.718),

    ('htft_2_2_away_lock', [
        ('MS2_CLOSE', 1.65, 2.30),
        ('HT_MS2_CLOSE', 2.20, 3.0),
    ], make_htft_outcome('A', 'A'), 0.69),

    # GROUP 5: Special correlations
    ('msx_310_320_draw', [
        ('MSX_CLOSE', 3.10, 3.20),
    ], out_draw, 0.2892),

    ('ms1_185_203_home', [
        ('MS1_CLOSE', 1.85, 2.03),
    ], out_home_win, 0.48),

    ('ms1_250_300_upset', [
        ('MS1_CLOSE', 2.50, 3.0),
        ('MSX_CLOSE', None, 3.25),
    ], out_draw, 0.31),

    # GROUP 7: Additional
    ('ht_goal_msx_lock', [
        ('MSX_CLOSE', 4.0, None),
        ('HT_05_OVER_CLOSE', None, 1.30),
    ], out_ht_over_05, 0.78),

    ('ht_no_goal_defensive', [
        ('HT_05_UNDER_CLOSE', None, 1.80),
        ('OVER_25_CLOSE', 2.50, None),
    ], out_ht_under_15, 0.85),

    ('mega_goals_lock', [
        ('OVER_05_CLOSE', None, 1.05),
        ('OVER_15_CLOSE', None, 1.22),
        ('OVER_25_CLOSE', None, 1.50),
    ], out_over_25, 0.88),
]


def main():
    print(f'🎯 Validating built-in odds patterns against {DB_PATH}')
    print(f'   {len(PATTERNS)} patterns to validate')

    conn = sqlite3.connect(str(DB_PATH))

    # Build SELECT for all needed columns
    needed_cols = set()
    for _, conditions, _, _ in PATTERNS:
        for market, _, _ in conditions:
            if market in COL_MAP:
                needed_cols.add(COL_MAP[market])

    cols_list = sorted(needed_cols) + ['home_goals', 'away_goals', 'fhalf']
    select_str = ', '.join(cols_list)

    print(f'\n📥 Loading Pinnacle matches with relevant columns...')
    cursor = conn.execute(f"""
        SELECT {select_str}
        FROM pinnacle_matches
        WHERE home_goals IS NOT NULL
          AND away_goals IS NOT NULL
          AND fhalf IS NOT NULL AND fhalf != ''
          AND c_ft1_18 != ''
          AND c_ftx_18 != ''
          AND c_ft2_18 != ''
    """)

    col_idx = {col: i for i, col in enumerate(cols_list)}

    # Pattern stats: pattern_id → (matches, hits)
    stats = {p[0]: [0, 0] for p in PATTERNS}
    base_rate_count = 0
    base_rates = {
        'home_win': 0, 'draw': 0, 'away_win': 0,
        'over_25': 0, 'over_15': 0, 'btts_yes': 0,
    }

    loaded = 0
    for row in cursor:
        loaded += 1
        if loaded % 200_000 == 0:
            print(f'  ... {loaded:,} rows')

        h_goals = row[col_idx['home_goals']]
        a_goals = row[col_idx['away_goals']]
        fhalf = row[col_idx['fhalf']]

        # Update base rates
        base_rate_count += 1
        if h_goals > a_goals:
            base_rates['home_win'] += 1
        elif h_goals == a_goals:
            base_rates['draw'] += 1
        else:
            base_rates['away_win'] += 1
        if h_goals + a_goals >= 3:
            base_rates['over_25'] += 1
        if h_goals + a_goals >= 2:
            base_rates['over_15'] += 1
        if h_goals > 0 and a_goals > 0:
            base_rates['btts_yes'] += 1

        # Cache odds for this row
        odds_cache = {}
        for market, db_col in COL_MAP.items():
            if db_col in col_idx:
                odds_cache[market] = safe_float(row[col_idx[db_col]])

        # Check each pattern
        for pattern_id, conditions, outcome_fn, _ in PATTERNS:
            satisfied = True
            for market, min_v, max_v in conditions:
                v = odds_cache.get(market)
                if v is None:
                    satisfied = False
                    break
                if min_v is not None and v < min_v:
                    satisfied = False
                    break
                if max_v is not None and v > max_v:
                    satisfied = False
                    break

            if not satisfied:
                continue

            outcome = outcome_fn(h_goals, a_goals, fhalf)
            if outcome is None:
                continue

            stats[pattern_id][0] += 1
            if outcome:
                stats[pattern_id][1] += 1

    conn.close()
    print(f'  ✓ Processed {loaded:,} matches')

    # Compute results
    base_rates_norm = {k: v / base_rate_count for k, v in base_rates.items()}
    print(f'\n📊 Base rates: H={base_rates_norm["home_win"]*100:.1f}% D={base_rates_norm["draw"]*100:.1f}% A={base_rates_norm["away_win"]*100:.1f}% O25={base_rates_norm["over_25"]*100:.1f}% BTTS={base_rates_norm["btts_yes"]*100:.1f}%')

    output_patterns = {}
    print(f'\n🏆 Pattern validation results:')
    print(f'{"Pattern ID":<35s} {"Sample":>8s} {"Hits":>8s} {"Rate":>8s} {"Source":>8s} {"Banko":>6s}')
    print(f'{"-"*80}')

    sorted_patterns = sorted(PATTERNS, key=lambda p: -stats[p[0]][1])
    for pattern_id, _, _, source_rate in sorted_patterns:
        sample, hits = stats[pattern_id]
        rate = hits / sample if sample > 0 else 0
        is_banko = sample >= BANKO_MIN_SAMPLE and rate >= BANKO_MIN_RATE
        # Approximate base rate for lift calc
        # Lift requires knowing target outcome — skip for simplicity
        output_patterns[pattern_id] = {
            'hitRate': round(rate, 4),
            'sampleSize': sample,
            'isBanko': is_banko,
            'sourceHitRate': source_rate,
        }
        marker = '🎯' if is_banko else '  '
        print(f'  {pattern_id:<33s} {sample:>8d} {hits:>8d} {rate*100:>7.1f}% {source_rate*100:>7.1f}% {marker}')

    output = {
        'generated_at': datetime.now().isoformat(),
        'total_matches_used': loaded,
        'base_rates': base_rates_norm,
        'patterns': output_patterns,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with OUT_FILE.open('w') as f:
        json.dump(output, f, indent=2)

    size_kb = OUT_FILE.stat().st_size / 1024
    print(f'\n✓ Wrote {OUT_FILE}')
    print(f'  Size: {size_kb:.0f} KB')
    n_banko = sum(1 for p in output_patterns.values() if p['isBanko'])
    print(f'  Banko patterns: {n_banko}/{len(output_patterns)}')


if __name__ == '__main__':
    main()
