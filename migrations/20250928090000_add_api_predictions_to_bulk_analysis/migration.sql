ALTER TABLE "bulk_analysis_results" ADD COLUMN "api_predicted_winner" TEXT;
ALTER TABLE "bulk_analysis_results" ADD COLUMN "api_winner_confidence" REAL;
ALTER TABLE "bulk_analysis_results" ADD COLUMN "api_over_under_prediction" TEXT;
ALTER TABLE "bulk_analysis_results" ADD COLUMN "api_over_under_confidence" REAL;
ALTER TABLE "bulk_analysis_results" ADD COLUMN "api_prediction_advice" TEXT;
ALTER TABLE "bulk_analysis_results" ADD COLUMN "algorithms_agree_winner" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bulk_analysis_results" ADD COLUMN "algorithms_agree_over_under" BOOLEAN NOT NULL DEFAULT false;
