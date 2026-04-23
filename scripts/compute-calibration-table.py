#!/usr/bin/env python3
"""
Compute per-market odds → actual outcome calibration tables from 20 years
of Pinnacle closing odds. This tells us: given a bookmaker closing odd X for
market Y, what is the TRUE empirical probability of that outcome?

Output: lib/probet/calibration-table.json

Usage:
  python3 scripts/compute-calibration-table.py

The resulting table is used at runtime to:
  1. Convert live odds from API-Football into "true probability" estimates
  2. Boost or penalize picks based on how well-calibrated the bookmaker was
  3. Auto-tune MARKET_RELIABILITY weights in probet-engine
"""

import sqlite3
import json
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / 'data' / 'odds.db'
OUT_PATH = Path(__file__).parent.parent / 'lib' / 'probet' / 'calibration-table.json'

# Odds buckets for lookup tables. Each market gets its own buckets.
ODDS_BUCKETS = [
    (1.00, 1.20),
    (1.20, 1.35),
    (1.35, 1.50),
    (1.50, 1.65),
    (1.65, 1.80),
    (1.80, 1.95),
    (1.95, 2.10),
    (2.10, 2.30),
    (2.30, 2.60),
    (2.60, 3.00),
    (3.00, 3.50),
    (3.50, 4.50),
    (4.50, 6.00),
    (6.00, 999),
]


def compute_market(
    conn: sqlite3.Connection,
    label: str,
    odds_col: str,
    hit_condition: str,
) -> list[dict]:
    """
    For a market, bucket the matches by closing odds and compute the
    empirical hit rate in each bucket.

    Returns a list of buckets: {low, high, count, hits, rate, implied_prob}
    """
    results = []
    for low, high in ODDS_BUCKETS:
        cursor = conn.execute(
            f"""
            SELECT
                COUNT(*) as n,
                SUM(CASE WHEN {hit_condition} THEN 1 ELSE 0 END) as hits
            FROM pinnacle_matches
            WHERE home_goals IS NOT NULL
              AND {odds_col} != ''
              AND CAST({odds_col} AS REAL) >= ?
              AND CAST({odds_col} AS REAL) < ?
        """,
            (low, high),
        )
        n, hits = cursor.fetchone()
        if n is None or n < 100:  # Ignore tiny buckets for stability
            continue
        rate = hits / n if n > 0 else 0
        implied = 1 / ((low + high) / 2)  # Midpoint implied probability
        results.append(
            {
                'odds_low': round(low, 2),
                'odds_high': round(high, 2) if high < 999 else None,
                'count': n,
                'hits': hits,
                'rate': round(rate, 4),
                'implied': round(implied, 4),
                'calibration_ratio': round(rate / implied, 3) if implied > 0 else None,
            }
        )
    return results


def main():
    print(f'🎯 Computing calibration tables from {DB_PATH}')
    conn = sqlite3.connect(str(DB_PATH))

    # Define markets with their odds columns and hit conditions
    markets = [
        # --- 1X2 ---
        ('HOME_WIN', 'c_ft1_18', 'home_goals > away_goals'),
        ('DRAW', 'c_ftx_18', 'home_goals = away_goals'),
        ('AWAY_WIN', 'c_ft2_18', 'home_goals < away_goals'),
        # --- Double Chance ---
        ('DC_1X', 'c_dc1x_18', 'home_goals >= away_goals'),
        ('DC_12', 'c_dc12_18', 'home_goals != away_goals'),
        ('DC_X2', 'c_dcx2_18', 'home_goals <= away_goals'),
        # --- Over/Under Goals ---
        ('OVER_05', 'c_fto05_18', '(home_goals + away_goals) >= 1'),
        ('UNDER_05', 'c_ftu05_18', '(home_goals + away_goals) = 0'),
        ('OVER_15', 'c_fto15_18', '(home_goals + away_goals) >= 2'),
        ('UNDER_15', 'c_ftu15_18', '(home_goals + away_goals) <= 1'),
        ('OVER_25', 'c_fto25_18', '(home_goals + away_goals) >= 3'),
        ('UNDER_25', 'c_ftu25_18', '(home_goals + away_goals) <= 2'),
        ('OVER_35', 'c_fto35_18', '(home_goals + away_goals) >= 4'),
        ('UNDER_35', 'c_ftu35_18', '(home_goals + away_goals) <= 3'),
        ('OVER_45', 'c_fto45_18', '(home_goals + away_goals) >= 5'),
        ('UNDER_45', 'c_ftu45_18', '(home_goals + away_goals) <= 4'),
        # --- BTTS ---
        ('BTTS_YES', 'c_btts1_18', 'home_goals > 0 AND away_goals > 0'),
        ('BTTS_NO', 'c_btts2_18', 'home_goals = 0 OR away_goals = 0'),
        # --- Half-time ---
        # Pinnacle has 1H markets too: c_st1_18, c_stx_18, c_st2_18 (1st half)
        # but they're labelled as `st` for set_1 / 1st half.
        # We'll skip these for now — requires separate parsing of fhalf score
    ]

    output = {
        'generated_at': None,
        'total_matches': None,
        'note': (
            'Calibration tables from 20 years of Pinnacle closing odds. '
            'For each market, buckets odds into ranges and reports the '
            'empirical hit rate in each bucket. Use at runtime to map '
            'live API odds → data-driven probabilities.'
        ),
        'markets': {},
    }

    cursor = conn.execute(
        "SELECT COUNT(*) FROM pinnacle_matches WHERE home_goals IS NOT NULL"
    )
    total = cursor.fetchone()[0]
    output['total_matches'] = total
    print(f'  {total:,} matches with known outcomes')

    for market, col, cond in markets:
        buckets = compute_market(conn, market, col, cond)
        if not buckets:
            print(f'  ⚠ {market}: no data')
            continue
        total_n = sum(b['count'] for b in buckets)
        total_hits = sum(b['hits'] for b in buckets)
        overall_rate = total_hits / total_n if total_n > 0 else 0
        output['markets'][market] = {
            'column': col,
            'total_samples': total_n,
            'total_hits': total_hits,
            'overall_rate': round(overall_rate, 4),
            'buckets': buckets,
        }
        print(f'  ✓ {market:12s}: {total_n:>7,} samples, overall={overall_rate*100:.1f}%')

    # Also compute some cross-market stats
    print('\n📊 Computing extra stats...')

    # Which odds range gives the MOST reliable signal?
    # For each market, find the bucket with highest (rate - |rate - 0.5|) * log(count)
    # i.e. sharpest signal away from 50/50
    best_picks = {}
    for market, data in output['markets'].items():
        if not data['buckets']:
            continue
        best = max(
            data['buckets'],
            key=lambda b: abs(b['rate'] - 0.5) * (b['count'] ** 0.5),
        )
        best_picks[market] = {
            'odds_low': best['odds_low'],
            'odds_high': best['odds_high'],
            'rate': best['rate'],
            'count': best['count'],
        }

    output['best_signal_per_market'] = best_picks

    from datetime import datetime, timezone
    output['generated_at'] = datetime.now(timezone.utc).isoformat()

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open('w') as f:
        json.dump(output, f, indent=2)
    print(f'\n✓ Wrote {OUT_PATH}')
    print(f'  Size: {OUT_PATH.stat().st_size / 1024:.1f} KB')

    conn.close()


if __name__ == '__main__':
    main()
