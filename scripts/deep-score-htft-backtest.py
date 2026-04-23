#!/usr/bin/env python3
"""
Deep backtest: generate MAXIMUM calibration tables from 651K Bet365
closing-odds archive. Bet365 has full HTFT + exact score opening/closing
odds, plus precomputed result flags (MS1mi, Iy1mi, Ust25Mu, KgMi, etc).

OUTPUTS (under lib/probet/):
  1. htft-calibration-table.json      — 9 HTFT outcomes × 14 odds buckets × per-league
  2. score-calibration-table.json     — 25 exact scores × 14 odds buckets
  3. joint-calibration-table.json     — BTTS × O/U and HTFT × score correlations
  4. league-season-calibration.json   — Top 30 leagues × year breakdown
"""

import sqlite3
import json
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / 'data' / 'odds.db'
OUT_DIR = Path(__file__).parent.parent / 'lib' / 'probet'
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Odds bucket boundaries — matches odds-knn.ts for consistency
BUCKETS = [
    ('A', 1.00, 1.30),
    ('B', 1.30, 1.45),
    ('C', 1.45, 1.60),
    ('D', 1.60, 1.75),
    ('E', 1.75, 1.90),
    ('F', 1.90, 2.05),
    ('G', 2.05, 2.25),
    ('H', 2.25, 2.50),
    ('I', 2.50, 2.85),
    ('J', 2.85, 3.30),
    ('K', 3.30, 4.00),
    ('L', 4.00, 5.00),
    ('M', 5.00, 7.00),
    ('N', 7.00, 1000),
]

# Extended buckets for rare high-odds markets (HTFT / exact score)
HIGH_ODDS_BUCKETS = BUCKETS + [
    ('O', 7.00, 10.00),
    ('P', 10.00, 15.00),
    ('Q', 15.00, 25.00),
    ('R', 25.00, 50.00),
    ('S', 50.00, 100.00),
    ('T', 100.00, 1000),
]


# ────────────────────────────────────────────────────────────────
# HTFT calibration — using Bet365 closing odds (kahtft*)
# ────────────────────────────────────────────────────────────────

HTFT_MARKETS = [
    # Bet365 column naming: kahtft{ht}{ft}_odds for closing, achtft*_odds for opening
    # ht/ft codes: 1=home, x=draw, 2=away
    ('1/1', 'kahtft11_odds', 'achtft11_odds',
     "home_goals > away_goals AND fhalf_h > fhalf_a"),
    ('1/X', 'kahtft1x_odds', 'achtft1x_odds',
     "home_goals = away_goals AND fhalf_h > fhalf_a"),
    ('1/2', 'kahtft12_odds', 'achtft12_odds',
     "home_goals < away_goals AND fhalf_h > fhalf_a"),
    ('X/1', 'kahtftx1_odds', 'achtftx1_odds',
     "home_goals > away_goals AND fhalf_h = fhalf_a"),
    ('X/X', 'kahtftxx_odds', 'achtftxx_odds',
     "home_goals = away_goals AND fhalf_h = fhalf_a"),
    ('X/2', 'kahtftx2_odds', 'achtftx2_odds',
     "home_goals < away_goals AND fhalf_h = fhalf_a"),
    ('2/1', 'kahtft21_odds', 'achtft21_odds',
     "home_goals > away_goals AND fhalf_h < fhalf_a"),
    ('2/X', 'kahtft2x_odds', 'achtft2x_odds',
     "home_goals = away_goals AND fhalf_h < fhalf_a"),
    ('2/2', 'kahtft22_odds', 'achtft22_odds',
     "home_goals < away_goals AND fhalf_h < fhalf_a"),
]


def ensure_fhalf_columns(conn):
    """Parse mac1st_odds into fhalf_h / fhalf_a INTEGER columns."""
    cursor = conn.execute("PRAGMA table_info(bet365_matches)")
    cols = [r[1] for r in cursor]
    if 'fhalf_h' in cols:
        return
    print('  Adding fhalf_h / fhalf_a columns...')
    conn.execute("ALTER TABLE bet365_matches ADD COLUMN fhalf_h INTEGER")
    conn.execute("ALTER TABLE bet365_matches ADD COLUMN fhalf_a INTEGER")
    conn.execute("""
        UPDATE bet365_matches
        SET fhalf_h = CAST(SUBSTR(mac1st_odds, 1, INSTR(mac1st_odds, ':') - 1) AS INTEGER),
            fhalf_a = CAST(SUBSTR(mac1st_odds, INSTR(mac1st_odds, ':') + 1) AS INTEGER)
        WHERE mac1st_odds LIKE '%:%'
    """)
    conn.commit()


def compute_htft_calibration(conn):
    print('\n📊 HTFT calibration (from Bet365 651K matches)...')
    ensure_fhalf_columns(conn)

    output = {
        'note': 'HTFT calibration from Bet365 closing odds (ka* columns). Odds → empirical hit rate.',
        'source': 'bet365_matches',
        'markets': {},
        'per_league': {},
    }

    for outcome, close_col, open_col, hit_cond in HTFT_MARKETS:
        buckets = []
        for bname, low, high in HIGH_ODDS_BUCKETS:
            cursor = conn.execute(
                f"""
                SELECT COUNT(*) as n,
                       SUM(CASE WHEN {hit_cond} THEN 1 ELSE 0 END) as hits
                FROM bet365_matches
                WHERE home_goals IS NOT NULL
                  AND fhalf_h IS NOT NULL
                  AND {close_col} != ''
                  AND CAST({close_col} AS REAL) >= ?
                  AND CAST({close_col} AS REAL) < ?
                """,
                (low, high),
            )
            n, hits = cursor.fetchone()
            if n is None or n < 50:
                continue
            rate = hits / n if n else 0
            buckets.append(
                {
                    'bucket': bname,
                    'odds_low': round(low, 2),
                    'odds_high': round(high, 2) if high < 1000 else None,
                    'count': n,
                    'hits': hits,
                    'rate': round(rate, 4),
                }
            )

        total_n = sum(b['count'] for b in buckets)
        total_hits = sum(b['hits'] for b in buckets)
        overall = total_hits / total_n if total_n else 0

        output['markets'][outcome] = {
            'close_column': close_col,
            'open_column': open_col,
            'total_samples': total_n,
            'total_hits': total_hits,
            'overall_rate': round(overall, 4),
            'buckets': buckets,
        }
        print(f'  {outcome:4s}: {total_n:>6,} samples, overall {overall*100:5.2f}% ({len(buckets)} buckets)')

    # Per-league for key HTFT outcomes
    print('\n  Per-league analysis...')
    for outcome, close_col, _, hit_cond in HTFT_MARKETS:
        if outcome not in ('1/1', '2/2', 'X/X', '2/1', '1/2', 'X/1', 'X/2'):
            continue
        cursor = conn.execute(
            f"""
            SELECT lig_odds, COUNT(*) as n,
                   SUM(CASE WHEN {hit_cond} THEN 1 ELSE 0 END) as hits
            FROM bet365_matches
            WHERE home_goals IS NOT NULL
              AND fhalf_h IS NOT NULL
              AND {close_col} != ''
              AND lig_odds IS NOT NULL
            GROUP BY lig_odds
            HAVING n >= 500
            ORDER BY n DESC
            LIMIT 30
            """
        )
        per_league = []
        for lname, n, hits in cursor:
            per_league.append(
                {
                    'league': lname,
                    'count': n,
                    'hits': hits,
                    'rate': round(hits / n, 4) if n else 0,
                }
            )
        output['per_league'][outcome] = per_league

    with (OUT_DIR / 'htft-calibration-table.json').open('w') as f:
        json.dump(output, f, indent=2)
    print(f'  ✓ Wrote htft-calibration-table.json')


# ────────────────────────────────────────────────────────────────
# Exact score calibration — Bet365 kamacsk* columns
# ────────────────────────────────────────────────────────────────

SCORE_MARKETS = [
    ('1-0', 'kamacsk10_odds'),
    ('2-0', 'kamacsk20_odds'),
    ('2-1', 'kamacsk21_odds'),
    ('3-0', 'kamacsk30_odds'),
    ('3-1', 'kamacsk31_odds'),
    ('3-2', 'kamacsk32_odds'),
    ('4-0', 'kamacsk40_odds'),
    ('4-1', 'kamacsk41_odds'),
    ('4-2', 'kamacsk42_odds'),
    ('4-3', 'kamacsk43_odds'),
    ('0-0', 'kamacsk00_odds'),
    ('1-1', 'kamacsk11_odds'),
    ('2-2', 'kamacsk22_odds'),
    ('3-3', 'kamacsk33_odds'),
    ('4-4', 'kamacsk44_odds'),
    ('0-1', 'kamacsk01_odds'),
    ('0-2', 'kamacsk02_odds'),
    ('1-2', 'kamacsk12_odds'),
    ('0-3', 'kamacsk03_odds'),
    ('1-3', 'kamacsk13_odds'),
    ('2-3', 'kamacsk23_odds'),
    ('0-4', 'kamacsk04_odds'),
    ('1-4', 'kamacsk14_odds'),
    ('2-4', 'kamacsk24_odds'),
    ('3-4', 'kamacsk34_odds'),
]


def compute_score_calibration(conn):
    print('\n📊 Exact score calibration (from Bet365)...')
    output = {
        'note': 'Exact score calibration from Bet365 closing odds (ka* columns).',
        'source': 'bet365_matches',
        'markets': {},
    }

    for score, col in SCORE_MARKETS:
        h, a = map(int, score.split('-'))
        hit_cond = f'home_goals = {h} AND away_goals = {a}'

        buckets = []
        for bname, low, high in HIGH_ODDS_BUCKETS:
            cursor = conn.execute(
                f"""
                SELECT COUNT(*) as n,
                       SUM(CASE WHEN {hit_cond} THEN 1 ELSE 0 END) as hits
                FROM bet365_matches
                WHERE home_goals IS NOT NULL
                  AND {col} != ''
                  AND CAST({col} AS REAL) >= ?
                  AND CAST({col} AS REAL) < ?
                """,
                (low, high),
            )
            n, hits = cursor.fetchone()
            if n is None or n < 50:
                continue
            buckets.append(
                {
                    'bucket': bname,
                    'odds_low': round(low, 2),
                    'odds_high': round(high, 2) if high < 1000 else None,
                    'count': n,
                    'hits': hits,
                    'rate': round(hits / n, 4),
                }
            )

        total_n = sum(b['count'] for b in buckets)
        total_hits = sum(b['hits'] for b in buckets)
        output['markets'][score] = {
            'column': col,
            'total_samples': total_n,
            'total_hits': total_hits,
            'overall_rate': round(total_hits / total_n, 4) if total_n else 0,
            'buckets': buckets,
        }
        print(f'  {score}: {total_n:>6,} samples, overall {output["markets"][score]["overall_rate"]*100:5.2f}% ({len(buckets)} buckets)')

    with (OUT_DIR / 'score-calibration-table.json').open('w') as f:
        json.dump(output, f, indent=2)
    print(f'  ✓ Wrote score-calibration-table.json')


# ────────────────────────────────────────────────────────────────
# Joint market calibration (BTTS × O/U)
# ────────────────────────────────────────────────────────────────


def compute_joint_calibration(conn):
    print('\n📊 Joint market calibration (BTTS × O/U)...')
    combos = [
        ('BTTS_YES_AND_OVER_25', 'home_goals > 0 AND away_goals > 0 AND (home_goals + away_goals) >= 3'),
        ('BTTS_YES_AND_UNDER_25', 'home_goals > 0 AND away_goals > 0 AND (home_goals + away_goals) < 3'),
        ('BTTS_NO_AND_OVER_25', '(home_goals = 0 OR away_goals = 0) AND (home_goals + away_goals) >= 3'),
        ('BTTS_NO_AND_UNDER_25', '(home_goals = 0 OR away_goals = 0) AND (home_goals + away_goals) < 3'),
    ]
    output = {'note': 'Joint BTTS × Over/Under 2.5 rates', 'combinations': {}}

    # Use Pinnacle (more data and already parsed)
    for name, cond in combos:
        cursor = conn.execute(
            f"""
            SELECT COUNT(*) as n,
                   SUM(CASE WHEN {cond} THEN 1 ELSE 0 END) as hits
            FROM pinnacle_matches
            WHERE home_goals IS NOT NULL
            """
        )
        n, hits = cursor.fetchone()
        output['combinations'][name] = {
            'count': n,
            'hits': hits,
            'rate': round(hits / n, 4) if n else 0,
        }
        print(f'  {name}: {hits:,}/{n:,} = {output["combinations"][name]["rate"]*100:.1f}%')

    # HTFT × Score combinations
    print('\n  HTFT × Score correlations (Bet365)...')
    htft_score_combos = [
        ('2/1_and_2-1', 'home_goals = 2 AND away_goals = 1 AND fhalf_h < fhalf_a'),
        ('2/1_and_3-1', 'home_goals = 3 AND away_goals = 1 AND fhalf_h < fhalf_a'),
        ('2/1_and_3-2', 'home_goals = 3 AND away_goals = 2 AND fhalf_h < fhalf_a'),
        ('1/1_and_2-0', 'home_goals = 2 AND away_goals = 0 AND fhalf_h > fhalf_a'),
        ('1/1_and_1-0', 'home_goals = 1 AND away_goals = 0 AND fhalf_h > fhalf_a'),
        ('X/X_and_0-0', 'home_goals = 0 AND away_goals = 0'),
        ('X/X_and_1-1', 'home_goals = 1 AND away_goals = 1 AND fhalf_h = 0 AND fhalf_a = 0'),
        ('X/1_and_1-0', 'home_goals = 1 AND away_goals = 0 AND fhalf_h = fhalf_a'),
        ('X/2_and_0-1', 'home_goals = 0 AND away_goals = 1 AND fhalf_h = fhalf_a'),
    ]
    output['htft_score_combos'] = {}
    for name, cond in htft_score_combos:
        cursor = conn.execute(
            f"""
            SELECT COUNT(*) as n,
                   SUM(CASE WHEN {cond} THEN 1 ELSE 0 END) as hits
            FROM bet365_matches
            WHERE home_goals IS NOT NULL AND fhalf_h IS NOT NULL
            """
        )
        n, hits = cursor.fetchone()
        output['htft_score_combos'][name] = {
            'count': n,
            'hits': hits,
            'rate': round(hits / n, 4) if n else 0,
        }
        print(f'  {name}: {hits:,}/{n:,} = {output["htft_score_combos"][name]["rate"]*100:.2f}%')

    with (OUT_DIR / 'joint-calibration-table.json').open('w') as f:
        json.dump(output, f, indent=2)
    print(f'  ✓ Wrote joint-calibration-table.json')


# ────────────────────────────────────────────────────────────────
# League × season calibration
# ────────────────────────────────────────────────────────────────


def compute_league_season_calibration(conn):
    print('\n📊 League × season calibration (top 30 leagues)...')
    cursor = conn.execute(
        """
        SELECT lleague, COUNT(*) as n
        FROM pinnacle_matches
        WHERE home_goals IS NOT NULL AND lleague IS NOT NULL
        GROUP BY lleague
        ORDER BY n DESC
        LIMIT 30
        """
    )
    top_leagues = [row[0] for row in cursor]

    output = {'note': 'League × season base rates for key markets', 'leagues': {}}
    for lname in top_leagues:
        league_data = {'seasons': {}}
        cursor = conn.execute(
            """
            SELECT SUBSTR(date_iso, 1, 4) as yr, COUNT(*) as n,
                   SUM(CASE WHEN home_goals > away_goals THEN 1 ELSE 0 END) as home_wins,
                   SUM(CASE WHEN home_goals = away_goals THEN 1 ELSE 0 END) as draws,
                   SUM(CASE WHEN home_goals < away_goals THEN 1 ELSE 0 END) as away_wins,
                   SUM(CASE WHEN (home_goals + away_goals) >= 3 THEN 1 ELSE 0 END) as over_25,
                   SUM(CASE WHEN home_goals > 0 AND away_goals > 0 THEN 1 ELSE 0 END) as btts_yes,
                   SUM(home_goals + away_goals) as total_goals
            FROM pinnacle_matches
            WHERE lleague = ? AND home_goals IS NOT NULL AND date_iso IS NOT NULL
            GROUP BY yr
            ORDER BY yr
            """,
            (lname,),
        )
        for yr, n, hw, d, aw, o25, btts, tg in cursor:
            if n < 30:
                continue
            league_data['seasons'][yr] = {
                'n': n,
                'home_win_rate': round(hw / n, 4),
                'draw_rate': round(d / n, 4),
                'away_win_rate': round(aw / n, 4),
                'over_25_rate': round(o25 / n, 4),
                'btts_rate': round(btts / n, 4),
                'avg_goals': round(tg / n, 3) if tg else 0,
            }
        if league_data['seasons']:
            output['leagues'][lname] = league_data
            seasons_count = len(league_data['seasons'])
            print(f'  {lname:35s}: {seasons_count} seasons')

    with (OUT_DIR / 'league-season-calibration.json').open('w') as f:
        json.dump(output, f, indent=2)
    print(f'  ✓ Wrote league-season-calibration.json')


def main():
    print(f'🎯 Deep calibration from {DB_PATH}')
    conn = sqlite3.connect(str(DB_PATH))

    compute_htft_calibration(conn)
    compute_score_calibration(conn)
    compute_joint_calibration(conn)
    compute_league_season_calibration(conn)

    conn.close()

    print('\n📁 Output files:')
    for name in ('htft-calibration-table.json', 'score-calibration-table.json',
                 'joint-calibration-table.json', 'league-season-calibration.json'):
        path = OUT_DIR / name
        if path.exists():
            size_kb = path.stat().st_size / 1024
            print(f'  {name}: {size_kb:.1f} KB')


if __name__ == '__main__':
    main()
