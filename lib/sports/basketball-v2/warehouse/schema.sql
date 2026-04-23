-- Basketball v2 Data Warehouse Schema
-- ─────────────────────────────────────────────────────────────────────────────
-- Persistent postgres tables for NBA + basketball historical data.
-- Hosted on awa-postgres/probet (same DB as probet tracking store).
-- All statements idempotent — safe to run on every container start.
--
-- Naming convention: bb_* prefix for basketball-v2 tables (avoids collision
-- with prediction tracking tables).

-- ─────────────────────────────────────────────────────────────────────────────
-- GAMES (both NBA v2 and basketball v1, unified schema)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bb_games (
  id              TEXT PRIMARY KEY,      -- 'nba:16677' or 'basketball:487665'
  source          TEXT NOT NULL,         -- 'nba' | 'basketball'
  api_game_id     INTEGER NOT NULL,
  league_id       INTEGER NOT NULL,
  league_name     TEXT,
  season          TEXT NOT NULL,         -- '2025' (NBA) or '2025-2026' (basketball)

  game_date       TIMESTAMPTZ NOT NULL,
  status_short    TEXT,                  -- 'FT', 'NS', 'Q1', etc
  status_long     TEXT,

  home_team_id    INTEGER NOT NULL,
  home_team_name  TEXT NOT NULL,
  home_team_code  TEXT,
  away_team_id    INTEGER NOT NULL,
  away_team_name  TEXT NOT NULL,
  away_team_code  TEXT,

  -- Scores (null if not finished)
  home_score      INTEGER,
  away_score      INTEGER,

  -- Quarter linescores (JSONB array, e.g. [31, 30, 18, 25])
  home_linescore  JSONB,
  away_linescore  JSONB,

  -- Venue
  venue_name      TEXT,
  venue_city      TEXT,

  -- Raw payload for auditing / schema evolution
  raw_data        JSONB,

  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bb_games_source ON bb_games(source);
CREATE INDEX IF NOT EXISTS idx_bb_games_league_season ON bb_games(league_id, season);
CREATE INDEX IF NOT EXISTS idx_bb_games_date ON bb_games(game_date);
CREATE INDEX IF NOT EXISTS idx_bb_games_home_team ON bb_games(home_team_id);
CREATE INDEX IF NOT EXISTS idx_bb_games_away_team ON bb_games(away_team_id);
CREATE INDEX IF NOT EXISTS idx_bb_games_status ON bb_games(status_short);
CREATE INDEX IF NOT EXISTS idx_bb_games_api_id ON bb_games(source, api_game_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEAM SEASON AGGREGATES (Four Factors, pace, ratings — cached)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bb_team_season_aggregates (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL,
  league_id       INTEGER NOT NULL,
  season          TEXT NOT NULL,
  team_id         INTEGER NOT NULL,
  team_name       TEXT,

  games_played    INTEGER NOT NULL DEFAULT 0,

  -- Volume stats (per-season totals)
  points          INTEGER,
  points_allowed  INTEGER,
  fgm             INTEGER,
  fga             INTEGER,
  ftm             INTEGER,
  fta             INTEGER,
  tpm             INTEGER,             -- 3-point made
  tpa             INTEGER,
  off_reb         INTEGER,
  def_reb         INTEGER,
  assists         INTEGER,
  steals          INTEGER,
  blocks          INTEGER,
  turnovers       INTEGER,
  personal_fouls  INTEGER,

  -- Four Factors (Dean Oliver, per-game)
  efg_pct         DOUBLE PRECISION,    -- (FGM + 0.5*3PM) / FGA
  tov_pct         DOUBLE PRECISION,    -- TOV / (FGA + 0.44*FTA + TOV)
  orb_pct         DOUBLE PRECISION,    -- OREB / (OREB + opponent DREB)
  ft_rate         DOUBLE PRECISION,    -- FTM / FGA

  -- Opponent Four Factors (defensive mirror)
  opp_efg_pct     DOUBLE PRECISION,
  opp_tov_pct     DOUBLE PRECISION,
  opp_orb_pct     DOUBLE PRECISION,
  opp_ft_rate     DOUBLE PRECISION,

  -- Pace + ratings
  pace            DOUBLE PRECISION,    -- Possessions per 48 minutes
  off_rating      DOUBLE PRECISION,    -- Points per 100 possessions
  def_rating      DOUBLE PRECISION,    -- Points allowed per 100 possessions
  net_rating      DOUBLE PRECISION,

  -- Home/away splits
  home_games      INTEGER DEFAULT 0,
  home_wins       INTEGER DEFAULT 0,
  away_games      INTEGER DEFAULT 0,
  away_wins       INTEGER DEFAULT 0,

  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (source, league_id, season, team_id)
);

CREATE INDEX IF NOT EXISTS idx_bb_team_agg_lookup ON bb_team_season_aggregates(source, league_id, season, team_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- PLAYER GAME LOGS (NBA only — v1 basketball API doesn't expose player stats)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bb_player_game_logs (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL DEFAULT 'nba',
  game_id         TEXT NOT NULL,       -- 'nba:16677'
  api_game_id     INTEGER NOT NULL,
  player_id       INTEGER NOT NULL,
  player_name     TEXT,
  team_id         INTEGER NOT NULL,
  team_name       TEXT,

  minutes         DOUBLE PRECISION,    -- parsed to decimal minutes
  points          INTEGER,
  fgm             INTEGER,
  fga             INTEGER,
  ftm             INTEGER,
  fta             INTEGER,
  tpm             INTEGER,
  tpa             INTEGER,
  off_reb         INTEGER,
  def_reb         INTEGER,
  total_reb       INTEGER,
  assists         INTEGER,
  steals          INTEGER,
  blocks          INTEGER,
  turnovers       INTEGER,
  personal_fouls  INTEGER,
  plus_minus      INTEGER,

  position        TEXT,
  is_starter      BOOLEAN,
  dnp             BOOLEAN,             -- Did Not Play

  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (source, api_game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_bb_player_logs_player ON bb_player_game_logs(player_id);
CREATE INDEX IF NOT EXISTS idx_bb_player_logs_team ON bb_player_game_logs(team_id);
CREATE INDEX IF NOT EXISTS idx_bb_player_logs_game ON bb_player_game_logs(game_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- PLAYER SEASON AVERAGES (cached aggregates with std devs for prop modeling)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bb_player_season_averages (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL DEFAULT 'nba',
  player_id       INTEGER NOT NULL,
  player_name     TEXT,
  team_id         INTEGER NOT NULL,
  team_name       TEXT,
  season          TEXT NOT NULL,

  games_played    INTEGER NOT NULL DEFAULT 0,
  games_started   INTEGER DEFAULT 0,

  -- Averages
  mpg             DOUBLE PRECISION,
  ppg             DOUBLE PRECISION,
  rpg             DOUBLE PRECISION,
  apg             DOUBLE PRECISION,
  spg             DOUBLE PRECISION,
  bpg             DOUBLE PRECISION,
  topg            DOUBLE PRECISION,
  tpmpg           DOUBLE PRECISION,
  tpapg           DOUBLE PRECISION,
  fg_pct          DOUBLE PRECISION,
  ft_pct          DOUBLE PRECISION,
  tp_pct          DOUBLE PRECISION,
  plus_minus_avg  DOUBLE PRECISION,
  usage_rate      DOUBLE PRECISION,

  -- Standard deviations (for over/under props)
  ppg_std         DOUBLE PRECISION,
  rpg_std         DOUBLE PRECISION,
  apg_std         DOUBLE PRECISION,
  tpmpg_std       DOUBLE PRECISION,

  -- Correlation matrix for DD/TD combos (stored as JSONB)
  -- { "pts_reb": 0.28, "pts_ast": 0.32, "reb_ast": 0.14 }
  correlations    JSONB,

  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (source, player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_bb_player_season_lookup ON bb_player_season_averages(source, player_id, season);
CREATE INDEX IF NOT EXISTS idx_bb_player_season_team ON bb_player_season_averages(team_id, season);

-- ─────────────────────────────────────────────────────────────────────────────
-- TEAM RATINGS (ELO + Bayesian posterior time series)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bb_team_ratings (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL,
  league_id       INTEGER NOT NULL,
  season          TEXT NOT NULL,
  team_id         INTEGER NOT NULL,
  as_of_date      DATE NOT NULL,         -- ratings snapshot date

  -- ELO (classic chess-style)
  elo             DOUBLE PRECISION NOT NULL,
  elo_games       INTEGER NOT NULL DEFAULT 0,

  -- Bayesian hierarchical (normal conjugate)
  -- Posterior distribution of team offensive skill
  off_mean        DOUBLE PRECISION,      -- μ posterior
  off_var         DOUBLE PRECISION,      -- σ² posterior
  def_mean        DOUBLE PRECISION,
  def_var         DOUBLE PRECISION,

  -- Massey rating (linear system)
  massey          DOUBLE PRECISION,

  -- Composite (blended ensemble rating)
  composite       DOUBLE PRECISION,

  -- Home court advantage (learned per team, deviation from league HCA)
  home_adv        DOUBLE PRECISION DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (source, league_id, season, team_id, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_bb_ratings_current ON bb_team_ratings(source, league_id, season, team_id, as_of_date DESC);
CREATE INDEX IF NOT EXISTS idx_bb_ratings_date ON bb_team_ratings(as_of_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- QUARTER SHARES (empirical % of total points per quarter, per league)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bb_quarter_shares (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL,
  league_id       INTEGER NOT NULL,
  season          TEXT NOT NULL,

  q1_share        DOUBLE PRECISION NOT NULL,   -- e.g. 0.246
  q2_share        DOUBLE PRECISION NOT NULL,
  q3_share        DOUBLE PRECISION NOT NULL,
  q4_share        DOUBLE PRECISION NOT NULL,

  -- Halftime shares (convenience)
  fh_share        DOUBLE PRECISION NOT NULL,   -- q1+q2
  sh_share        DOUBLE PRECISION NOT NULL,   -- q3+q4

  -- Variance of quarter-share distributions (for Monte Carlo)
  q1_std          DOUBLE PRECISION,
  q2_std          DOUBLE PRECISION,
  q3_std          DOUBLE PRECISION,
  q4_std          DOUBLE PRECISION,

  sample_games    INTEGER NOT NULL,           -- how many games this was computed from

  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (source, league_id, season)
);

CREATE INDEX IF NOT EXISTS idx_bb_quarter_shares_lookup ON bb_quarter_shares(source, league_id, season);

-- ─────────────────────────────────────────────────────────────────────────────
-- ODDS SNAPSHOTS (timestamped for Subsystem D — steam/RLM detection)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bb_odds_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL,
  game_id         TEXT NOT NULL,
  api_game_id     INTEGER NOT NULL,
  bookmaker       TEXT NOT NULL,

  snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Full odds payload (JSONB for flexibility — different bet types per bookie)
  odds_data       JSONB NOT NULL,

  -- Extracted highlights for fast queries
  home_moneyline  DOUBLE PRECISION,
  away_moneyline  DOUBLE PRECISION,
  spread_line     DOUBLE PRECISION,
  spread_home_odds DOUBLE PRECISION,
  total_line      DOUBLE PRECISION,
  over_odds       DOUBLE PRECISION,
  under_odds      DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_bb_odds_game ON bb_odds_snapshots(game_id);
CREATE INDEX IF NOT EXISTS idx_bb_odds_snapshot_at ON bb_odds_snapshots(snapshot_at);
CREATE INDEX IF NOT EXISTS idx_bb_odds_bookmaker ON bb_odds_snapshots(bookmaker);

-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL JOBS (track backfill progress + errors)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bb_backfill_jobs (
  id              BIGSERIAL PRIMARY KEY,
  job_type        TEXT NOT NULL,          -- 'nba_seasons', 'basketball_leagues', etc
  source          TEXT NOT NULL,
  target          TEXT NOT NULL,          -- description of what's being backfilled

  status          TEXT NOT NULL DEFAULT 'pending',  -- pending, running, done, failed
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,

  progress_done   INTEGER DEFAULT 0,
  progress_total  INTEGER DEFAULT 0,

  error_message   TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bb_backfill_status ON bb_backfill_jobs(status);
CREATE INDEX IF NOT EXISTS idx_bb_backfill_type ON bb_backfill_jobs(job_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- ML MODEL CACHE (per-league trained gradient boost models)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bb_ml_models (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL,
  league_id       INTEGER NOT NULL,
  season          TEXT NOT NULL,
  model_type      TEXT NOT NULL,          -- 'gradient_boost_classifier', 'regressor', etc
  target          TEXT NOT NULL,          -- 'match_result', 'total_over_under', 'spread_cover'

  model_data      JSONB NOT NULL,         -- Serialized model (trees, weights)
  feature_names   JSONB NOT NULL,
  training_samples INTEGER,

  -- Training quality
  cv_accuracy     DOUBLE PRECISION,
  cv_log_loss     DOUBLE PRECISION,
  cv_brier        DOUBLE PRECISION,

  trained_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,

  UNIQUE (source, league_id, season, model_type, target, trained_at)
);

CREATE INDEX IF NOT EXISTS idx_bb_ml_models_lookup ON bb_ml_models(source, league_id, season, target, trained_at DESC);
