#!/usr/bin/env python3
"""
Build a k-nearest-neighbor odds lookup for ProBet live predictions.

GOAL: Given a live odds profile (e.g. Home=1.85, Draw=3.50, Away=4.20,
Over2.5=1.90, BTTS=1.80), find the N most similar past matches from the
20-year Pinnacle/Bet365 database and return the empirical outcome
distribution. This acts as a data-driven "prior" that grounds every
prediction in real historical behavior.

OUTPUT:
  1. lib/probet/odds-knn-index.json — bucketized index for fast JS lookup
  2. lib/probet/odds-knn-profiles.json — compact profile representations

ARCHITECTURE:
  We don't do full k-NN at query time (too slow in JS with 800K rows).
  Instead, we precompute a BUCKETIZED index:

    bucket_key = f"{home_bucket}-{draw_bucket}-{over25_bucket}"

  where each bucket is a range (e.g. 1.60-1.80 → "B6"). For each bucket
  we store the aggregated outcome counts. At query time in JS, we just
  look up the bucket containing the live odds profile and read the stats.

  This is O(1) lookup and gives a very good approximation of true k-NN
  results because similar odds profiles land in the same bucket.
"""

import sqlite3
import json
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / 'data' / 'odds.db'
OUT_DIR = Path(__file__).parent.parent / 'lib' / 'probet'
OUT_INDEX = OUT_DIR / 'odds-knn-index.json'

# Odds → bucket: we use logarithmic bucketing so low odds get fine granularity
# (where the biggest accuracy lives) and high odds get coarse buckets.
def odds_bucket(odds: float) -> str:
    """
    Convert a decimal odds value to a compact bucket identifier.
    Low odds get narrower buckets because small differences matter more.

    Ranges:
      <1.30 → "A"
      1.30-1.45 → "B"
      1.45-1.60 → "C"
      1.60-1.75 → "D"
      1.75-1.90 → "E"
      1.90-2.05 → "F"
      2.05-2.25 → "G"
      2.25-2.50 → "H"
      2.50-2.85 → "I"
      2.85-3.30 → "J"
      3.30-4.00 → "K"
      4.00-5.00 → "L"
      5.00-7.00 → "M"
      >=7.00    → "N"
    """
    if odds < 1.30: return 'A'
    if odds < 1.45: return 'B'
    if odds < 1.60: return 'C'
    if odds < 1.75: return 'D'
    if odds < 1.90: return 'E'
    if odds < 2.05: return 'F'
    if odds < 2.25: return 'G'
    if odds < 2.50: return 'H'
    if odds < 2.85: return 'I'
    if odds < 3.30: return 'J'
    if odds < 4.00: return 'K'
    if odds < 5.00: return 'L'
    if odds < 7.00: return 'M'
    return 'N'


def safe_float(s):
    if not s:
        return None
    try:
        v = float(s)
        return v if v > 1.01 else None
    except (ValueError, TypeError):
        return None


def main():
    print(f'🎯 Building k-NN odds lookup from {DB_PATH}')
    conn = sqlite3.connect(str(DB_PATH))

    # Fetch matches with CLOSING odds + outcomes.
    # We need: 1X2 closing, Over/Under 2.5 closing, BTTS closing, + outcome.
    print('\n📥 Loading Pinnacle matches (with closing odds)...')
    cursor = conn.execute("""
        SELECT
            c_ft1_18, c_ftx_18, c_ft2_18,
            c_fto25_18, c_ftu25_18,
            c_btts1_18, c_btts2_18,
            c_fto15_18, c_ftu15_18,
            c_fto35_18, c_ftu35_18,
            home_goals, away_goals
        FROM pinnacle_matches
        WHERE home_goals IS NOT NULL
          AND c_ft1_18 != '' AND c_ftx_18 != '' AND c_ft2_18 != ''
          AND c_fto25_18 != ''
    """)

    # Bucketized index: key → stats
    # Key: f"{home_b}-{draw_b}-{away_b}-{over25_b}"
    from collections import defaultdict

    def make_bucket():
        return {
            'count': 0,
            'home_win': 0,
            'draw': 0,
            'away_win': 0,
            'over_15': 0,
            'over_25': 0,
            'over_35': 0,
            'btts_yes': 0,
            # Goals sum for averages
            'sum_goals': 0,
        }

    # Multiple index granularities for different use cases
    # Full: 1X2 × O/U 2.5 = 14^4 = 38K buckets (too many)
    # Compact: home_bucket × over25_bucket = 14 × 14 = 196 buckets
    # Best: home_bucket × draw_bucket × over25_bucket = 14^3 = 2744 buckets
    buckets_1x2_ou = defaultdict(make_bucket)    # home × draw × over25
    buckets_home_ou = defaultdict(make_bucket)   # home × over25 (simpler)
    buckets_1x2 = defaultdict(make_bucket)       # home × draw × away (pure 1X2)

    loaded = 0
    used = 0
    for row in cursor:
        loaded += 1
        if loaded % 100_000 == 0:
            print(f'  ... {loaded:,} rows')

        c_h, c_d, c_a = safe_float(row[0]), safe_float(row[1]), safe_float(row[2])
        c_o25, c_u25 = safe_float(row[3]), safe_float(row[4])
        c_btts_y, c_btts_n = safe_float(row[5]), safe_float(row[6])
        c_o15, c_u15 = safe_float(row[7]), safe_float(row[8])
        c_o35, c_u35 = safe_float(row[9]), safe_float(row[10])

        if c_h is None or c_d is None or c_a is None or c_o25 is None:
            continue

        hg, ag = row[11], row[12]
        if hg is None or ag is None:
            continue
        total = hg + ag

        h_b = odds_bucket(c_h)
        d_b = odds_bucket(c_d)
        a_b = odds_bucket(c_a)
        o25_b = odds_bucket(c_o25)

        # Outcomes
        home_win = 1 if hg > ag else 0
        draw = 1 if hg == ag else 0
        away_win = 1 if hg < ag else 0
        over_15 = 1 if total >= 2 else 0
        over_25 = 1 if total >= 3 else 0
        over_35 = 1 if total >= 4 else 0
        btts = 1 if hg > 0 and ag > 0 else 0

        # Update each index
        for key, idx in [
            (f'{h_b}-{d_b}-{o25_b}', buckets_1x2_ou),
            (f'{h_b}-{o25_b}', buckets_home_ou),
            (f'{h_b}-{d_b}-{a_b}', buckets_1x2),
        ]:
            b = idx[key]
            b['count'] += 1
            b['home_win'] += home_win
            b['draw'] += draw
            b['away_win'] += away_win
            b['over_15'] += over_15
            b['over_25'] += over_25
            b['over_35'] += over_35
            b['btts_yes'] += btts
            b['sum_goals'] += total

        used += 1

    conn.close()
    print(f'  ✓ Loaded {loaded:,} rows, used {used:,} with full closing odds')
    print(f'  Buckets: {len(buckets_1x2_ou)} (1X2×O25), {len(buckets_home_ou)} (H×O25), {len(buckets_1x2)} (pure 1X2)')

    # Normalize all buckets to rates
    def finalize(idx):
        result = {}
        for key, b in idx.items():
            if b['count'] < 10:  # Too few samples
                continue
            n = b['count']
            result[key] = {
                'n': n,
                'home_win_rate': round(b['home_win'] / n, 4),
                'draw_rate': round(b['draw'] / n, 4),
                'away_win_rate': round(b['away_win'] / n, 4),
                'over_15_rate': round(b['over_15'] / n, 4),
                'over_25_rate': round(b['over_25'] / n, 4),
                'over_35_rate': round(b['over_35'] / n, 4),
                'btts_rate': round(b['btts_yes'] / n, 4),
                'avg_goals': round(b['sum_goals'] / n, 3),
            }
        return result

    output = {
        'total_matches_used': used,
        'note': (
            'k-NN odds index. Bucket keys encode 1X2 + Over/Under 2.5 '
            'closing odds. At query time, bucket the live odds and look '
            'up the empirical outcome distribution in this table. '
            'Samples with <10 matches in a bucket are excluded.'
        ),
        'bucket_scheme': {
            'A': '<1.30', 'B': '1.30-1.45', 'C': '1.45-1.60', 'D': '1.60-1.75',
            'E': '1.75-1.90', 'F': '1.90-2.05', 'G': '2.05-2.25', 'H': '2.25-2.50',
            'I': '2.50-2.85', 'J': '2.85-3.30', 'K': '3.30-4.00', 'L': '4.00-5.00',
            'M': '5.00-7.00', 'N': '>=7.00',
        },
        'index_1x2_ou25': finalize(buckets_1x2_ou),
        'index_home_ou25': finalize(buckets_home_ou),
        'index_1x2_pure': finalize(buckets_1x2),
    }

    OUT_INDEX.parent.mkdir(parents=True, exist_ok=True)
    with OUT_INDEX.open('w') as f:
        json.dump(output, f, separators=(',', ':'))

    size_kb = OUT_INDEX.stat().st_size / 1024
    print(f'\n✓ Wrote {OUT_INDEX}')
    print(f'  Size: {size_kb:.0f} KB')
    print(f'  index_1x2_ou25: {len(output["index_1x2_ou25"])} buckets')
    print(f'  index_home_ou25: {len(output["index_home_ou25"])} buckets')
    print(f'  index_1x2_pure: {len(output["index_1x2_pure"])} buckets')

    # Print a few sample buckets to verify
    print('\n📊 Sample lookups:')
    for key in list(output['index_1x2_ou25'].keys())[:5]:
        b = output['index_1x2_ou25'][key]
        print(f"  {key}: n={b['n']:6d} H={b['home_win_rate']*100:5.1f}% D={b['draw_rate']*100:5.1f}% A={b['away_win_rate']*100:5.1f}% O25={b['over_25_rate']*100:5.1f}%")


if __name__ == '__main__':
    main()
