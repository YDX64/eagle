#!/usr/bin/env python3
"""
Import the 20-year Pinnacle + Bet365 odds CSVs into a SQLite database
with sensible indexing for fast lookups and backtest queries.

Source files:
  /Users/max/Downloads/eagle-1/oran/adaptive_pinnacle_matches.csv  (796K rows, Pinnacle)
  /Users/max/Downloads/eagle-1/oran/oranarsivi_bet365_complete.csv (651K rows, Bet365)

Target DB:
  /Users/max/Downloads/eagle-1/.claude/worktrees/youthful-haibt/data/odds.db

Tables:
  - pinnacle_matches: 1 row per match with all ~297 fields (Pinnacle opening+closing)
  - bet365_matches:   1 row per match with all ~260 fields (Bet365 opening+closing)

Indexes:
  - (home, away, dateth) for team-based joining with API-Football fixtures
  - (dateth) for date-range queries
  - (league, lleague) for league filtering

This is a ONE-TIME import that takes ~2-3 minutes for 1.4M rows.
Subsequent queries against the SQLite DB are sub-second.
"""

import csv
import sqlite3
import sys
from pathlib import Path
from time import time

# Raise CSV field limit for very long odds rows
csv.field_size_limit(10_000_000)

# Paths
ORAN_DIR = Path('/Users/max/Downloads/eagle-1/oran')
DB_PATH = Path(__file__).parent.parent / 'data' / 'odds.db'
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

PINNACLE_CSV = ORAN_DIR / 'adaptive_pinnacle_matches.csv'
BET365_CSV = ORAN_DIR / 'oranarsivi_bet365_complete.csv'


def sanitize_column(col: str) -> str:
    """SQLite-safe column name: replace non-alphanumerics with underscores."""
    safe = ''.join(c if c.isalnum() else '_' for c in col)
    # Avoid starting with digit
    if safe and safe[0].isdigit():
        safe = 'c_' + safe
    return safe or 'col'


def create_schema(conn: sqlite3.Connection, table: str, columns: list[str]) -> None:
    """Create table with all columns as TEXT (simple, max-flexibility)."""
    safe_cols = [sanitize_column(c) for c in columns]
    # Dedupe in order (some CSVs may have duplicate column names)
    seen = set()
    unique_cols = []
    for c in safe_cols:
        base = c
        idx = 1
        while c in seen:
            idx += 1
            c = f'{base}_{idx}'
        seen.add(c)
        unique_cols.append(c)

    cols_ddl = ', '.join(f'"{c}" TEXT' for c in unique_cols)
    conn.execute(f'DROP TABLE IF EXISTS {table}')
    conn.execute(f'CREATE TABLE {table} ({cols_ddl})')
    return unique_cols


def import_csv(conn: sqlite3.Connection, csv_path: Path, table: str) -> int:
    """Stream the CSV into the target table. Returns row count."""
    print(f'\n📥 Importing {csv_path.name} → {table}...')
    start = time()

    with csv_path.open('r', encoding='utf-8', errors='replace') as f:
        reader = csv.reader(f)
        header = next(reader)
        print(f'  Columns: {len(header)}')

        safe_cols = create_schema(conn, table, header)
        placeholders = ', '.join('?' * len(safe_cols))
        insert_sql = f'INSERT INTO {table} VALUES ({placeholders})'

        batch = []
        count = 0
        BATCH_SIZE = 10_000

        for row in reader:
            # Pad or truncate to match header length
            if len(row) < len(safe_cols):
                row = row + [''] * (len(safe_cols) - len(row))
            elif len(row) > len(safe_cols):
                row = row[: len(safe_cols)]
            batch.append(row)

            if len(batch) >= BATCH_SIZE:
                conn.executemany(insert_sql, batch)
                count += len(batch)
                if count % 100_000 == 0:
                    elapsed = time() - start
                    rate = count / elapsed
                    print(f'  ... {count:,} rows ({rate:.0f}/sec, {elapsed:.1f}s)')
                batch = []

        if batch:
            conn.executemany(insert_sql, batch)
            count += len(batch)

    conn.commit()
    elapsed = time() - start
    print(f'  ✓ Imported {count:,} rows in {elapsed:.1f}s')
    return count


def create_indexes(conn: sqlite3.Connection) -> None:
    """Add indexes for fast backtest lookups."""
    print('\n🔑 Creating indexes...')

    indexes = [
        # Pinnacle
        ('idx_pin_date', 'pinnacle_matches', 'dateth'),
        ('idx_pin_teams', 'pinnacle_matches', 'home, away'),
        ('idx_pin_league', 'pinnacle_matches', 'league, lleague'),
        ('idx_pin_matchid', 'pinnacle_matches', 'matchid'),
        # Bet365
        ('idx_bet_date', 'bet365_matches', 'TarihDt'),
        ('idx_bet_teams', 'bet365_matches', 'ev_odds, dep_odds'),
        ('idx_bet_league', 'bet365_matches', 'lig_odds, altlig_odds'),
    ]

    for name, table, cols in indexes:
        t0 = time()
        try:
            conn.execute(f'CREATE INDEX IF NOT EXISTS {name} ON {table} ({cols})')
            print(f'  ✓ {name} ({time() - t0:.1f}s)')
        except Exception as e:
            print(f'  ✗ {name}: {e}')

    conn.commit()


def add_summary_columns(conn: sqlite3.Connection) -> None:
    """
    Post-process: extract common fields into properly-typed columns for
    fast querying. We avoid re-parsing the raw TEXT columns on every query.
    """
    print('\n📊 Adding parsed summary columns...')

    # Pinnacle: parse dateth to a proper YYYY-MM-DD column and extract home/away goals
    # from the `score` field (format: "2-1")
    conn.execute("""
        ALTER TABLE pinnacle_matches ADD COLUMN date_iso TEXT
    """)
    conn.execute("""
        UPDATE pinnacle_matches
        SET date_iso = SUBSTR(dateth, 1, 10)
        WHERE dateth IS NOT NULL AND dateth != ''
    """)

    conn.execute("""
        ALTER TABLE pinnacle_matches ADD COLUMN home_goals INTEGER
    """)
    conn.execute("""
        ALTER TABLE pinnacle_matches ADD COLUMN away_goals INTEGER
    """)
    # Only update when score has format "X-Y"
    conn.execute("""
        UPDATE pinnacle_matches
        SET home_goals = CAST(SUBSTR(score, 1, INSTR(score, '-') - 1) AS INTEGER),
            away_goals = CAST(SUBSTR(score, INSTR(score, '-') + 1) AS INTEGER)
        WHERE score LIKE '%-%'
    """)

    # Bet365: extract date_iso from TarihDt (format: "2025-09-29T23:15:00")
    conn.execute("""
        ALTER TABLE bet365_matches ADD COLUMN date_iso TEXT
    """)
    conn.execute("""
        UPDATE bet365_matches
        SET date_iso = SUBSTR(TarihDt, 1, 10)
        WHERE TarihDt IS NOT NULL AND TarihDt != ''
    """)

    # Index the new date columns
    conn.execute('CREATE INDEX IF NOT EXISTS idx_pin_date_iso ON pinnacle_matches (date_iso)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_bet_date_iso ON bet365_matches (date_iso)')

    conn.commit()
    print('  ✓ Added date_iso, home_goals, away_goals columns')


def main():
    print(f'🎯 ProBet Odds Database Import')
    print(f'   Target: {DB_PATH}')

    conn = sqlite3.connect(str(DB_PATH))
    # Performance tuning for bulk insert
    conn.execute('PRAGMA journal_mode = OFF')
    conn.execute('PRAGMA synchronous = OFF')
    conn.execute('PRAGMA cache_size = 1000000')
    conn.execute('PRAGMA temp_store = MEMORY')

    total_start = time()

    # Import both CSVs
    pin_count = import_csv(conn, PINNACLE_CSV, 'pinnacle_matches')
    bet_count = import_csv(conn, BET365_CSV, 'bet365_matches')

    # Post-processing
    add_summary_columns(conn)
    create_indexes(conn)

    # Restore normal journaling
    conn.execute('PRAGMA journal_mode = WAL')
    conn.execute('PRAGMA synchronous = NORMAL')

    # Final stats
    print('\n' + '=' * 60)
    total_elapsed = time() - total_start
    db_size_mb = DB_PATH.stat().st_size / 1024 / 1024
    print(f'✓ Import complete in {total_elapsed:.1f}s')
    print(f'  Pinnacle: {pin_count:,} matches')
    print(f'  Bet365:   {bet_count:,} matches')
    print(f'  DB size:  {db_size_mb:.0f} MB')

    # Show a sample year breakdown
    print('\n📅 Pinnacle year distribution:')
    cursor = conn.execute("""
        SELECT SUBSTR(date_iso, 1, 4) as yr, COUNT(*) as n
        FROM pinnacle_matches
        WHERE date_iso IS NOT NULL
        GROUP BY yr
        ORDER BY yr
    """)
    for year, n in cursor:
        print(f'  {year}: {n:,}')

    conn.close()


if __name__ == '__main__':
    main()
