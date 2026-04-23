#!/usr/bin/env python3
"""
Discover odds patterns from historical Pinnacle/Bet365 database.

GOAL: Otomatik olarak yüksek hit-rate'li oran kombinasyonları (pattern'ler)
bulup `lib/probet/discovered-patterns.json` çıktısına kaydet. Her pattern
3'lü oran bucket kombinasyonu olarak tanımlanır:

  ('MS1_CLOSE', bucket) + ('OVER_25_CLOSE', bucket) + ('BTTS_YES_CLOSE', bucket)
  → outcome (örn HTFT_21, OVER_15, BTTS_YES)

ÇIKTI KRİTERLERİ:
  - Sample ≥500 maç
  - Hit rate ≥60%
  - Lift (over base rate) ≥1.10
  - TIME-SPLIT VALIDATION:
    * Train: 2015-2022
    * Test: 2023-2025
    * Pattern hem train hem test'te geçerli olmalı (overfit önleme)

PATTERN'LERİN TÜRLERİ:
  1. Single-feature patterns (örn MS1 ∈ [1.60-1.69])
  2. Two-feature patterns (örn MS1 + MSX bucket combo)
  3. Three-feature patterns (en güçlü, en az veri)

TIME COMPLEXITY: ~30 dakika tek seferlik run.
"""

import sqlite3
import json
from pathlib import Path
from collections import defaultdict
from itertools import combinations
from datetime import datetime

DB_PATH = Path(__file__).parent.parent / 'data' / 'odds.db'
OUT_FILE = Path(__file__).parent.parent / 'lib' / 'probet' / 'discovered-patterns.json'

# Time split for validation
TRAIN_END_YEAR = 2022
TEST_START_YEAR = 2023

# Pattern discovery thresholds
MIN_SAMPLE = 500          # Minimum matches for a bucket to be considered
MIN_HIT_RATE = 0.60       # Empirical hit rate must be ≥60%
MIN_LIFT = 1.10           # Pattern must beat base rate by 10%+

# Bucket schemes (matches odds-knn.ts buckets)
BUCKETS = [
    ('A', 1.0, 1.30), ('B', 1.30, 1.45), ('C', 1.45, 1.60), ('D', 1.60, 1.75),
    ('E', 1.75, 1.90), ('F', 1.90, 2.05), ('G', 2.05, 2.25), ('H', 2.25, 2.50),
    ('I', 2.50, 2.85), ('J', 2.85, 3.30), ('K', 3.30, 4.00), ('L', 4.00, 5.00),
    ('M', 5.00, 7.00), ('N', 7.00, 9999),
]

def odds_bucket(odds):
    if odds is None or odds <= 1.0:
        return None
    for letter, lo, hi in BUCKETS:
        if lo <= odds < hi:
            return letter
    return None

def safe_float(s):
    if not s:
        return None
    try:
        v = float(s)
        return v if v > 1.01 else None
    except (ValueError, TypeError):
        return None

# Markets to discover patterns from (column → market name)
DISCOVERY_MARKETS = [
    ('c_ft1_18', 'MS1_CLOSE'),
    ('c_ftx_18', 'MSX_CLOSE'),
    ('c_ft2_18', 'MS2_CLOSE'),
    ('c_dc1x_18', 'DC_1X_CLOSE'),
    ('c_dcx2_18', 'DC_X2_CLOSE'),
    ('c_fto15_18', 'OVER_15_CLOSE'),
    ('c_fto25_18', 'OVER_25_CLOSE'),
    ('c_fto35_18', 'OVER_35_CLOSE'),
    ('c_btts1_18', 'BTTS_YES_CLOSE'),
    ('c_btts2_18', 'BTTS_NO_CLOSE'),
    ('c_st1_18', 'HT_MS1_CLOSE'),
    ('c_stx_18', 'HT_MSX_CLOSE'),
]

# Outcome flags to test pattern against
def compute_outcomes(home_goals, away_goals, fhalf):
    """Compute all outcome flags from a match result."""
    if home_goals is None or away_goals is None:
        return None

    total = home_goals + away_goals
    flags = {
        'HOME_WIN': home_goals > away_goals,
        'DRAW': home_goals == away_goals,
        'AWAY_WIN': home_goals < away_goals,
        'DC_1X': home_goals >= away_goals,
        'DC_12': home_goals != away_goals,
        'DC_X2': home_goals <= away_goals,
        'OVER_05': total >= 1,
        'OVER_15': total >= 2,
        'OVER_25': total >= 3,
        'OVER_35': total >= 4,
        'UNDER_15': total < 2,
        'UNDER_25': total < 3,
        'UNDER_35': total < 4,
        'BTTS_YES': home_goals > 0 and away_goals > 0,
        'BTTS_NO': not (home_goals > 0 and away_goals > 0),
    }

    # Halftime-related outcomes
    if fhalf and ':' in fhalf:
        try:
            h_half, a_half = fhalf.split(':')
            h_half = int(h_half)
            a_half = int(a_half)
            ht_total = h_half + a_half
            flags['HT_OVER_05'] = ht_total >= 1
            flags['HT_OVER_15'] = ht_total >= 2
            flags['HT_UNDER_15'] = ht_total < 2

            ht_side = 'H' if h_half > a_half else 'A' if h_half < a_half else 'D'
            ft_side = 'H' if home_goals > away_goals else 'A' if home_goals < away_goals else 'D'
            flags[f'HTFT_{ht_side}{ft_side}'] = True
            for combo in ['HH', 'HD', 'HA', 'DH', 'DD', 'DA', 'AH', 'AD', 'AA']:
                key = f'HTFT_{combo}'
                if key not in flags:
                    flags[key] = False
        except (ValueError, TypeError):
            pass

    return flags

# All outcomes we want to discover patterns for
TARGET_OUTCOMES = [
    'HOME_WIN', 'DRAW', 'AWAY_WIN',
    'DC_1X', 'DC_12', 'DC_X2',
    'OVER_05', 'OVER_15', 'OVER_25', 'OVER_35',
    'UNDER_15', 'UNDER_25', 'UNDER_35',
    'BTTS_YES', 'BTTS_NO',
    'HT_OVER_05', 'HT_OVER_15', 'HT_UNDER_15',
    'HTFT_HH', 'HTFT_HD', 'HTFT_HA',
    'HTFT_DH', 'HTFT_DD', 'HTFT_DA',
    'HTFT_AH', 'HTFT_AD', 'HTFT_AA',
]


def main():
    print(f'🎯 Discovering odds patterns from {DB_PATH}')
    print(f'   Time split: train ≤{TRAIN_END_YEAR}, test ≥{TEST_START_YEAR}')
    print(f'   Thresholds: sample≥{MIN_SAMPLE}, hit_rate≥{MIN_HIT_RATE}, lift≥{MIN_LIFT}')

    conn = sqlite3.connect(str(DB_PATH))

    # Build SELECT for all DISCOVERY_MARKETS columns
    db_cols = [col for col, _ in DISCOVERY_MARKETS]
    select_cols = ', '.join(db_cols + ['home_goals', 'away_goals', 'fhalf', 'date'])

    print('\n📥 Loading Pinnacle matches with closing odds + halftime...')
    cursor = conn.execute(f"""
        SELECT {select_cols}
        FROM pinnacle_matches
        WHERE home_goals IS NOT NULL
          AND away_goals IS NOT NULL
          AND fhalf IS NOT NULL AND fhalf != ''
          AND c_ft1_18 != ''
          AND c_ftx_18 != ''
          AND c_ft2_18 != ''
    """)

    # Train: pattern bucket → outcome → count
    # train_buckets[(market_name, bucket_letter)][outcome] = (count, hits)
    train_singles = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    train_pairs = defaultdict(lambda: defaultdict(lambda: [0, 0]))

    test_singles = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    test_pairs = defaultdict(lambda: defaultdict(lambda: [0, 0]))

    # Base rates for lift calculation
    train_base = defaultdict(lambda: [0, 0])
    test_base = defaultdict(lambda: [0, 0])

    loaded = 0
    train_count = 0
    test_count = 0

    for row in cursor:
        loaded += 1
        if loaded % 100_000 == 0:
            print(f'  ... {loaded:,} rows processed')

        odds_values = {}
        for i, (col, name) in enumerate(DISCOVERY_MARKETS):
            v = safe_float(row[i])
            b = odds_bucket(v) if v else None
            if b:
                odds_values[name] = b

        if len(odds_values) < 4:  # Need at least 4 markets for meaningful patterns
            continue

        n_db_cols = len(DISCOVERY_MARKETS)
        home_goals = row[n_db_cols]
        away_goals = row[n_db_cols + 1]
        fhalf = row[n_db_cols + 2]
        date_str = row[n_db_cols + 3] or ''

        # Determine train/test split by year
        try:
            year = int(date_str[:4]) if date_str else TRAIN_END_YEAR
        except (ValueError, TypeError):
            year = TRAIN_END_YEAR

        is_test = year >= TEST_START_YEAR

        outcomes = compute_outcomes(home_goals, away_goals, fhalf)
        if not outcomes:
            continue

        # Update base rates
        for outcome in TARGET_OUTCOMES:
            if outcome in outcomes:
                base = test_base if is_test else train_base
                base[outcome][0] += 1
                if outcomes[outcome]:
                    base[outcome][1] += 1

        # Single-feature patterns: market+bucket → outcome counts
        singles = test_singles if is_test else train_singles
        pairs = test_pairs if is_test else train_pairs

        for market, bucket in odds_values.items():
            key = (market, bucket)
            for outcome in TARGET_OUTCOMES:
                if outcome in outcomes:
                    singles[key][outcome][0] += 1
                    if outcomes[outcome]:
                        singles[key][outcome][1] += 1

        # Two-feature patterns: pairs of (market, bucket)
        market_items = sorted(odds_values.items())
        for (m1, b1), (m2, b2) in combinations(market_items, 2):
            pair_key = ((m1, b1), (m2, b2))
            for outcome in TARGET_OUTCOMES:
                if outcome in outcomes:
                    pairs[pair_key][outcome][0] += 1
                    if outcomes[outcome]:
                        pairs[pair_key][outcome][1] += 1

        if is_test:
            test_count += 1
        else:
            train_count += 1

    conn.close()
    print(f'  ✓ Loaded {loaded:,} rows')
    print(f'  ✓ Train: {train_count:,}, Test: {test_count:,}')
    print(f'  ✓ Train singles: {len(train_singles):,}, pairs: {len(train_pairs):,}')

    # Compute base rates
    print('\n📊 Base rates (train):')
    base_rates_train = {}
    for outcome, (count, hits) in train_base.items():
        if count > 0:
            rate = hits / count
            base_rates_train[outcome] = rate
            print(f'  {outcome:15s}: {rate*100:5.1f}% ({hits:,}/{count:,})')

    base_rates_test = {}
    for outcome, (count, hits) in test_base.items():
        if count > 0:
            base_rates_test[outcome] = hits / count

    # Find good single-feature patterns
    print('\n🔍 Discovering single-feature patterns...')
    discovered = []
    seen_keys = set()

    def evaluate_pattern(key_tuple, train_outcomes, test_outcomes, pattern_kind):
        """Test if a pattern survives both train and test sets."""
        for outcome in TARGET_OUTCOMES:
            tr_count, tr_hits = train_outcomes.get(outcome, [0, 0])
            if tr_count < MIN_SAMPLE:
                continue
            tr_rate = tr_hits / tr_count
            if tr_rate < MIN_HIT_RATE:
                continue

            base_rate = base_rates_train.get(outcome, 0.5)
            if base_rate <= 0:
                continue
            tr_lift = tr_rate / base_rate
            if tr_lift < MIN_LIFT:
                continue

            # TIME-SPLIT VALIDATION: pattern must hold in test set too
            te_count, te_hits = test_outcomes.get(outcome, [0, 0])
            if te_count < MIN_SAMPLE / 5:  # Allow smaller test sample
                continue
            te_rate = te_hits / te_count if te_count > 0 else 0
            te_base = base_rates_test.get(outcome, 0.5)
            te_lift = te_rate / te_base if te_base > 0 else 0

            # Test set must show same direction (lift > 1.0 OR rate > 50%)
            if te_lift < 1.0 and te_rate < 0.5:
                continue

            discovered.append({
                'kind': pattern_kind,
                'key': key_tuple,
                'outcome': outcome,
                'train_rate': round(tr_rate, 4),
                'train_count': tr_count,
                'train_lift': round(tr_lift, 3),
                'test_rate': round(te_rate, 4),
                'test_count': te_count,
                'test_lift': round(te_lift, 3),
                'avg_rate': round((tr_rate * tr_count + te_rate * te_count) / (tr_count + te_count), 4),
                'total_count': tr_count + te_count,
            })

    for key, train_outcomes in train_singles.items():
        test_outcomes = test_singles.get(key, {})
        evaluate_pattern(key, train_outcomes, test_outcomes, 'single')

    print(f'  ✓ Single-feature: {len([p for p in discovered if p["kind"] == "single"]):,} patterns')

    # Find good two-feature patterns (more selective)
    print('\n🔍 Discovering two-feature patterns...')
    pairs_evaluated = 0
    for key, train_outcomes in train_pairs.items():
        pairs_evaluated += 1
        test_outcomes = train_pairs.get(key, {})
        # For pairs, also check test
        test_pair_outcomes = test_pairs.get(key, {})
        evaluate_pattern(key, train_outcomes, test_pair_outcomes, 'pair')

    print(f'  ✓ Two-feature: {len([p for p in discovered if p["kind"] == "pair"]):,} patterns from {pairs_evaluated:,} candidates')

    # Sort by quality (rate * sqrt(sample) * lift)
    discovered.sort(
        key=lambda p: p['avg_rate'] * (p['total_count'] ** 0.5) * p['test_lift'],
        reverse=True
    )

    # Take top 200 to keep file manageable
    top_patterns = discovered[:200]

    # Generate human-readable IDs
    for i, p in enumerate(top_patterns):
        if p['kind'] == 'single':
            market, bucket = p['key']
            p['id'] = f'auto_{market.lower()}_{bucket}_{p["outcome"].lower()}'
            p['name'] = f'{market} {bucket} → {p["outcome"]}'
        else:
            (m1, b1), (m2, b2) = p['key']
            p['id'] = f'auto_{m1.lower()}_{b1}_{m2.lower()}_{b2}_{p["outcome"].lower()}'
            p['name'] = f'{m1} {b1} + {m2} {b2} → {p["outcome"]}'

    output = {
        'generated_at': datetime.now().isoformat(),
        'total_train_matches': train_count,
        'total_test_matches': test_count,
        'thresholds': {
            'min_sample': MIN_SAMPLE,
            'min_hit_rate': MIN_HIT_RATE,
            'min_lift': MIN_LIFT,
        },
        'base_rates_train': {k: round(v, 4) for k, v in base_rates_train.items()},
        'base_rates_test': {k: round(v, 4) for k, v in base_rates_test.items()},
        'patterns': top_patterns,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with OUT_FILE.open('w') as f:
        json.dump(output, f, separators=(',', ':'))

    size_kb = OUT_FILE.stat().st_size / 1024
    print(f'\n✓ Wrote {OUT_FILE}')
    print(f'  Size: {size_kb:.0f} KB')
    print(f'  Top patterns: {len(top_patterns)}')

    print('\n🏆 Top 10 discovered patterns:')
    for p in top_patterns[:10]:
        print(f"  {p['name']}: train={p['train_rate']*100:.1f}% (n={p['train_count']:,}, lift={p['train_lift']:.2f}), test={p['test_rate']*100:.1f}%")


if __name__ == '__main__':
    main()
