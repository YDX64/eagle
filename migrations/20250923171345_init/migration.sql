-- CreateTable
CREATE TABLE "backtest_results" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "league_id" INTEGER,
    "team_id" INTEGER,
    "prediction_type" TEXT,
    "date_from" DATETIME NOT NULL,
    "date_to" DATETIME NOT NULL,
    "total_predictions" INTEGER NOT NULL,
    "correct_predictions" INTEGER NOT NULL,
    "success_rate" REAL NOT NULL,
    "home_win_count" INTEGER NOT NULL DEFAULT 0,
    "home_win_correct" INTEGER NOT NULL DEFAULT 0,
    "away_win_count" INTEGER NOT NULL DEFAULT 0,
    "away_win_correct" INTEGER NOT NULL DEFAULT 0,
    "draw_count" INTEGER NOT NULL DEFAULT 0,
    "draw_correct" INTEGER NOT NULL DEFAULT 0,
    "high_confidence_count" INTEGER NOT NULL DEFAULT 0,
    "high_confidence_correct" INTEGER NOT NULL DEFAULT 0,
    "medium_confidence_count" INTEGER NOT NULL DEFAULT 0,
    "medium_confidence_correct" INTEGER NOT NULL DEFAULT 0,
    "low_confidence_count" INTEGER NOT NULL DEFAULT 0,
    "low_confidence_correct" INTEGER NOT NULL DEFAULT 0,
    "total_stake" REAL,
    "total_return" REAL,
    "roi_percentage" REAL,
    "algorithm_version" TEXT NOT NULL DEFAULT '2.0',
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "prediction_statistics" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "period" TEXT NOT NULL,
    "period_date" DATETIME NOT NULL,
    "league_id" INTEGER,
    "league_name" TEXT,
    "team_id" INTEGER,
    "team_name" TEXT,
    "total_predictions" INTEGER NOT NULL DEFAULT 0,
    "correct_predictions" INTEGER NOT NULL DEFAULT 0,
    "success_rate" REAL NOT NULL DEFAULT 0,
    "match_winner_success" REAL,
    "btts_success" REAL,
    "over_under_success" REAL,
    "high_conf_success" REAL,
    "medium_conf_success" REAL,
    "low_conf_success" REAL,
    "best_prediction_type" TEXT,
    "best_confidence_range" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "analysis_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "start_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_time" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'running',
    "matches_analyzed" INTEGER NOT NULL DEFAULT 0,
    "high_conf_found" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "high_confidence_recommendations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "match_id" INTEGER NOT NULL,
    "confidence_tier" TEXT NOT NULL,
    "confidence_score" REAL NOT NULL,
    "recommendation" TEXT NOT NULL,
    "reasoning" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "high_confidence_recommendations_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "match_confidence_summaries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "match_id" INTEGER NOT NULL,
    "overall_confidence" REAL NOT NULL,
    "tier_classification" TEXT,
    "total_factors" INTEGER NOT NULL DEFAULT 0,
    "strong_factors" INTEGER NOT NULL DEFAULT 0,
    "summary_text" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "match_confidence_summaries_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_AnalysisRunToMatch" (
    "A" TEXT NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_AnalysisRunToMatch_A_fkey" FOREIGN KEY ("A") REFERENCES "analysis_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_AnalysisRunToMatch_B_fkey" FOREIGN KEY ("B") REFERENCES "matches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_matches" (
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
    "has_high_confidence_prediction" BOOLEAN NOT NULL DEFAULT false,
    "last_analysis_at" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "matches_league_id_league_season_fkey" FOREIGN KEY ("league_id", "league_season") REFERENCES "leagues" ("id", "season") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "matches_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "teams" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "matches_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "teams" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_matches" ("away_goals", "away_score_et", "away_score_ft", "away_score_ht", "away_score_pen", "away_team_id", "createdAt", "date", "home_goals", "home_score_et", "home_score_ft", "home_score_ht", "home_score_pen", "home_team_id", "id", "league_id", "league_round", "league_season", "referee", "status_elapsed", "status_long", "status_short", "timestamp", "timezone", "updatedAt", "venue_city", "venue_id", "venue_name") SELECT "away_goals", "away_score_et", "away_score_ft", "away_score_ht", "away_score_pen", "away_team_id", "createdAt", "date", "home_goals", "home_score_et", "home_score_ft", "home_score_ht", "home_score_pen", "home_team_id", "id", "league_id", "league_round", "league_season", "referee", "status_elapsed", "status_long", "status_short", "timestamp", "timezone", "updatedAt", "venue_city", "venue_id", "venue_name" FROM "matches";
DROP TABLE "matches";
ALTER TABLE "new_matches" RENAME TO "matches";
CREATE INDEX "matches_date_has_high_confidence_prediction_idx" ON "matches"("date", "has_high_confidence_prediction");
CREATE INDEX "matches_league_id_date_has_high_confidence_prediction_idx" ON "matches"("league_id", "date", "has_high_confidence_prediction");
CREATE TABLE "new_predictions" (
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
    "is_high_confidence" BOOLEAN NOT NULL DEFAULT false,
    "confidence_tier" TEXT,
    "confidence_rank" INTEGER,
    "analysis_run_id" TEXT,
    "expected_value" REAL,
    "kelly_percentage" REAL,
    "algorithm_version" TEXT NOT NULL DEFAULT '1.0',
    "factors_used" JSONB,
    "is_correct" BOOLEAN,
    "actual_result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "predictions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_predictions" ("actual_result", "algorithm_version", "away_form_score", "confidence_score", "createdAt", "factors_used", "goals_analysis_score", "head_to_head_score", "home_advantage_score", "home_form_score", "id", "is_correct", "match_id", "predicted_value", "prediction_type", "updatedAt") SELECT "actual_result", "algorithm_version", "away_form_score", "confidence_score", "createdAt", "factors_used", "goals_analysis_score", "head_to_head_score", "home_advantage_score", "home_form_score", "id", "is_correct", "match_id", "predicted_value", "prediction_type", "updatedAt" FROM "predictions";
DROP TABLE "predictions";
ALTER TABLE "new_predictions" RENAME TO "predictions";
CREATE INDEX "predictions_is_high_confidence_confidence_score_idx" ON "predictions"("is_high_confidence", "confidence_score");
CREATE INDEX "predictions_confidence_tier_createdAt_idx" ON "predictions"("confidence_tier", "createdAt");
CREATE INDEX "predictions_match_id_is_high_confidence_idx" ON "predictions"("match_id", "is_high_confidence");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "backtest_results_league_id_date_from_date_to_idx" ON "backtest_results"("league_id", "date_from", "date_to");

-- CreateIndex
CREATE INDEX "backtest_results_team_id_date_from_date_to_idx" ON "backtest_results"("team_id", "date_from", "date_to");

-- CreateIndex
CREATE INDEX "backtest_results_prediction_type_success_rate_idx" ON "backtest_results"("prediction_type", "success_rate");

-- CreateIndex
CREATE INDEX "prediction_statistics_period_period_date_idx" ON "prediction_statistics"("period", "period_date");

-- CreateIndex
CREATE INDEX "prediction_statistics_league_id_success_rate_idx" ON "prediction_statistics"("league_id", "success_rate");

-- CreateIndex
CREATE INDEX "prediction_statistics_team_id_success_rate_idx" ON "prediction_statistics"("team_id", "success_rate");

-- CreateIndex
CREATE INDEX "high_confidence_recommendations_confidence_tier_confidence_score_idx" ON "high_confidence_recommendations"("confidence_tier", "confidence_score");

-- CreateIndex
CREATE UNIQUE INDEX "match_confidence_summaries_match_id_key" ON "match_confidence_summaries"("match_id");

-- CreateIndex
CREATE UNIQUE INDEX "_AnalysisRunToMatch_AB_unique" ON "_AnalysisRunToMatch"("A", "B");

-- CreateIndex
CREATE INDEX "_AnalysisRunToMatch_B_index" ON "_AnalysisRunToMatch"("B");
