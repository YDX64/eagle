-- CreateTable
CREATE TABLE "leagues" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "logo" TEXT,
    "season" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "teams" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "country" TEXT,
    "founded" INTEGER,
    "national" BOOLEAN NOT NULL DEFAULT false,
    "logo" TEXT,
    "venue_id" INTEGER,
    "venue_name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "matches" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "referee" TEXT,
    "timezone" TEXT,
    "date" DATETIME NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "venue_id" INTEGER,
    "venue_name" TEXT,
    "venue_city" TEXT,
    "status_long" TEXT NOT NULL,
    "status_short" TEXT NOT NULL,
    "status_elapsed" INTEGER,
    "league_id" INTEGER NOT NULL,
    "league_season" INTEGER NOT NULL,
    "league_round" TEXT,
    "home_team_id" INTEGER NOT NULL,
    "away_team_id" INTEGER NOT NULL,
    "home_goals" INTEGER,
    "away_goals" INTEGER,
    "home_score_ht" INTEGER,
    "away_score_ht" INTEGER,
    "home_score_ft" INTEGER,
    "away_score_ft" INTEGER,
    "home_score_et" INTEGER,
    "away_score_et" INTEGER,
    "home_score_pen" INTEGER,
    "away_score_pen" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "matches_league_id_league_season_fkey" FOREIGN KEY ("league_id", "league_season") REFERENCES "leagues" ("id", "season") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "matches_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "teams" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "matches_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "teams" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "match_statistics" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "match_id" INTEGER NOT NULL,
    "team_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "shots_on_goal" INTEGER,
    "shots_off_goal" INTEGER,
    "total_shots" INTEGER,
    "blocked_shots" INTEGER,
    "shots_inside_box" INTEGER,
    "shots_outside_box" INTEGER,
    "fouls" INTEGER,
    "corner_kicks" INTEGER,
    "offside" INTEGER,
    "ball_possession" TEXT,
    "yellow_cards" INTEGER,
    "red_cards" INTEGER,
    "goalkeeper_saves" INTEGER,
    "total_passes" INTEGER,
    "passes_accurate" INTEGER,
    "passes_percentage" TEXT,
    "expected_goals" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "match_statistics_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "match_statistics_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "match_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "match_id" INTEGER NOT NULL,
    "team_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "comments" TEXT,
    "time_elapsed" INTEGER NOT NULL,
    "time_extra" INTEGER,
    "player_id" INTEGER,
    "player_name" TEXT,
    "assist_id" INTEGER,
    "assist_name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "match_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "match_events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "standings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "league_id" INTEGER NOT NULL,
    "league_season" INTEGER NOT NULL,
    "team_id" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "goalsDiff" INTEGER NOT NULL,
    "group" TEXT,
    "form" TEXT,
    "status" TEXT,
    "description" TEXT,
    "played" INTEGER NOT NULL,
    "win" INTEGER NOT NULL,
    "draw" INTEGER NOT NULL,
    "lose" INTEGER NOT NULL,
    "goals_for" INTEGER NOT NULL,
    "goals_against" INTEGER NOT NULL,
    "home_played" INTEGER NOT NULL,
    "home_win" INTEGER NOT NULL,
    "home_draw" INTEGER NOT NULL,
    "home_lose" INTEGER NOT NULL,
    "home_goals_for" INTEGER NOT NULL,
    "home_goals_against" INTEGER NOT NULL,
    "away_played" INTEGER NOT NULL,
    "away_win" INTEGER NOT NULL,
    "away_draw" INTEGER NOT NULL,
    "away_lose" INTEGER NOT NULL,
    "away_goals_for" INTEGER NOT NULL,
    "away_goals_against" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "standings_league_id_league_season_fkey" FOREIGN KEY ("league_id", "league_season") REFERENCES "leagues" ("id", "season") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "standings_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "team_statistics" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "team_id" INTEGER NOT NULL,
    "league_id" INTEGER NOT NULL,
    "league_season" INTEGER NOT NULL,
    "matches_played" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "draws" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "goals_for" INTEGER NOT NULL,
    "goals_against" INTEGER NOT NULL,
    "clean_sheets" INTEGER NOT NULL,
    "failed_to_score" INTEGER NOT NULL,
    "average_goals_for" REAL NOT NULL,
    "average_goals_against" REAL NOT NULL,
    "home_matches_played" INTEGER NOT NULL,
    "home_wins" INTEGER NOT NULL,
    "home_draws" INTEGER NOT NULL,
    "home_losses" INTEGER NOT NULL,
    "away_matches_played" INTEGER NOT NULL,
    "away_wins" INTEGER NOT NULL,
    "away_draws" INTEGER NOT NULL,
    "away_losses" INTEGER NOT NULL,
    "form_last_5" TEXT,
    "form_last_10" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "team_statistics_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "team_statistics_league_id_league_season_fkey" FOREIGN KEY ("league_id", "league_season") REFERENCES "leagues" ("id", "season") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "predictions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "match_id" INTEGER NOT NULL,
    "prediction_type" TEXT NOT NULL,
    "predicted_value" TEXT NOT NULL,
    "confidence_score" REAL NOT NULL,
    "home_form_score" REAL,
    "away_form_score" REAL,
    "head_to_head_score" REAL,
    "home_advantage_score" REAL,
    "goals_analysis_score" REAL,
    "algorithm_version" TEXT NOT NULL DEFAULT '1.0',
    "factors_used" JSONB,
    "is_correct" BOOLEAN,
    "actual_result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "predictions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "head_to_head" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "team1_id" INTEGER NOT NULL,
    "team2_id" INTEGER NOT NULL,
    "total_matches" INTEGER NOT NULL DEFAULT 0,
    "team1_wins" INTEGER NOT NULL DEFAULT 0,
    "team2_wins" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "team1_goals" INTEGER NOT NULL DEFAULT 0,
    "team2_goals" INTEGER NOT NULL DEFAULT 0,
    "last_5_results" TEXT,
    "last_match_date" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "head_to_head_team1_id_fkey" FOREIGN KEY ("team1_id") REFERENCES "teams" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "head_to_head_team2_id_fkey" FOREIGN KEY ("team2_id") REFERENCES "teams" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cache_entries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cache_key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "_LeagueToTeam" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_LeagueToTeam_A_fkey" FOREIGN KEY ("A") REFERENCES "leagues" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_LeagueToTeam_B_fkey" FOREIGN KEY ("B") REFERENCES "teams" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "leagues_id_season_key" ON "leagues"("id", "season");

-- CreateIndex
CREATE UNIQUE INDEX "match_statistics_match_id_team_id_key" ON "match_statistics"("match_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "standings_league_id_league_season_team_id_key" ON "standings"("league_id", "league_season", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_statistics_team_id_league_id_league_season_key" ON "team_statistics"("team_id", "league_id", "league_season");

-- CreateIndex
CREATE UNIQUE INDEX "head_to_head_team1_id_team2_id_key" ON "head_to_head"("team1_id", "team2_id");

-- CreateIndex
CREATE UNIQUE INDEX "cache_entries_cache_key_key" ON "cache_entries"("cache_key");

-- CreateIndex
CREATE UNIQUE INDEX "_LeagueToTeam_AB_unique" ON "_LeagueToTeam"("A", "B");

-- CreateIndex
CREATE INDEX "_LeagueToTeam_B_index" ON "_LeagueToTeam"("B");
