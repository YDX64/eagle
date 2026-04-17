# Prediction Fields Mapping

This reference consolidates the probability and metadata fields returned by each prediction source currently wired into the platform. Use it to understand how outputs align when constructing ensemble logic or expanding UI coverage.

## AwaStats Service (`lib/api-football.ts`)

| Field | Type | Range / Example | Notes |
| --- | --- | --- | --- |
| `predictions.percent.home` | string | `"42%"` | Home win percentage as a string with trailing `%`; normalize to decimal before weighting. |
| `predictions.percent.draw` | string | `"27%"` | Draw probability; same formatting caveats as home win. |
| `predictions.percent.away` | string | `"31%"` | Away win probability string. |
| `predictions.under_over` | string | `"Under 3.5"` | Recommended goal band derived from bookmaker odds. |
| `predictions.goals.home` | number | `1.4` | Expected home goals (Poisson mean). |
| `predictions.goals.away` | number | `1.1` | Expected away goals. |
| `predictions.advice` | string | `"Double chance : draw or away"` | Textual recommendation distilled from API consensus. |
| `comparison.form` | number | `62` | Recent form delta (0-100). |
| `comparison.att` | number | `58` | Attacking strength comparison. |
| `comparison.def` | number | `64` | Defensive strength comparison. |
| `comparison.h2h` | number | `55` | Head-to-head historical advantage. |
| `comparison.total` | number | `61` | Aggregated comparison index used for market consensus. |

## Basic Prediction Engine (`lib/prediction-engine.ts`)

| Field | Type | Range / Example | Notes |
| --- | --- | --- | --- |
| `match_winner.home_probability` | number | `0.48` | Decimal probability for home victory. |
| `match_winner.draw_probability` | number | `0.26` | Decimal probability for draw. |
| `match_winner.away_probability` | number | `0.26` | Decimal probability for away victory. |
| `both_teams_score.prediction` | `'yes' \| 'no'` | `'yes'` | BTTS direction based on form momentum. |
| `both_teams_score.confidence` | number | `0.62` | Strength of BTTS recommendation. |
| `over_under_goals.prediction` | `'over' \| 'under'` | `'over'` | Targets the 2.5 goal line. |
| `over_under_goals.confidence` | number | `0.59` | Confidence attached to the 2.5 goal pick. |
| `first_half_goals.home_first_half_probability` | number | `0.41` | Chance of home team scoring in the first half. |
| `first_half_goals.away_first_half_probability` | number | `0.37` | Chance of away team scoring in the first half. |
| `first_half_goals.over_0_5_probability` | number | `0.68` | Probability of at least one first-half goal. |
| `first_half_goals.over_1_5_probability` | number | `0.29` | Probability of two or more first-half goals. |

## Advanced Prediction Engine (`lib/advanced-prediction-engine.ts`)

_Probability outputs are percentages:_ The advanced engine expresses probability values on a 0–100 scale (rounded to two decimals) unless otherwise noted.

| Field | Type | Range / Example | Notes |
| --- | --- | --- | --- |
| `match_result.home_win.probability` | number | `45.0` | Requires normalization alongside draw and away win. |
| `match_result.draw.probability` | number | `28.0` | Draw probability. |
| `match_result.away_win.probability` | number | `27.0` | Away win probability. |
| `match_result.home_win.odds` | number | `2.05` | Implied odds from model blending. |
| `total_goals.under_0_5.probability` | number | `8.0` | Probability for under 0.5 goal market. |
| `total_goals.under_1_5.probability` | number | `21.0` | Under 1.5. |
| `total_goals.under_2_5.probability` | number | `46.0` | Under 2.5. |
| `total_goals.under_3_5.probability` | number | `68.0` | Under 3.5. |
| `total_goals.over_0_5.probability` | number | `92.0` | Over 0.5. |
| `total_goals.over_1_5.probability` | number | `79.0` | Over 1.5. |
| `total_goals.over_2_5.probability` | number | `54.0` | Over 2.5. |
| `total_goals.over_3_5.probability` | number | `32.0` | Over 3.5. |
| `both_teams_score.probability` | number | `58.0` | BTTS probability derived from correlated scoring. |
| `both_teams_score.odds` | number | `1.72` | Model price for BTTS yes. |
| `halftime_result.home_win.probability` | number | `40.0` | First half home win probability. |
| `halftime_result.draw.probability` | number | `36.0` | First half draw probability. |
| `halftime_result.away_win.probability` | number | `24.0` | First half away win probability. |
| `first_half_goals.total_over_0_5.probability` | number | `63.0` | Probability of at least one first-half goal. |
| `first_half_goals.total_under_0_5.probability` | number | `37.0` | Complementary market. |
| `home_team_goals.expected` | number | `1.55` | Expected goals assigned to the home side. |
| `away_team_goals.expected` | number | `1.18` | Expected goals assigned to the away side. |
| `exact_scores.top` | array | e.g. `[ { "score": "2-1", "probability": 14.0 } ]` | Ordered list of likely correct scores (probabilities in %). |
| `asian_handicap.lines` | array | e.g. `[ { "handicap": -0.25, "home_probability": 47.5, "away_probability": 52.5 } ]` | Handicap lines with percentage support for each side. |
| `corners.total_under_8_5` | number | `45.0` | Chance of 8 or fewer corners. |
| `corners.total_under_9_5` | number | `60.0` | Chance of 9 or fewer corners. |
| `corners.total_over_8_5` | number | `55.0` | Chance of 9 or more corners. |
| `corners.total_over_9_5` | number | `40.0` | Chance of 10 or more corners. |
| `cards.total_under_3_5` | number | `65.0` | Probability of three or fewer cards. |
| `cards.total_under_4_5` | number | `80.0` | Probability of four or fewer cards. |
| `cards.total_over_3_5` | number | `35.0` | Probability of four or more cards. |
| `cards.total_over_4_5` | number | `20.0` | Probability of five or more cards. |
| `first_goal.home_team.probability` | number | `46.0` | Likelihood the home team scores first. |
| `first_goal.away_team.probability` | number | `38.0` | Likelihood the away team scores first. |
| `first_goal.none.probability` | number | `16.0` | Probability of no goals. |
| `prediction_confidence` | number | `68.0` | Global confidence score (0-100). |
| `risk_analysis.low_risk` | array | `['Home win', 'Under 3.5 goals']` | Recommended low-risk markets. |
| `risk_analysis.medium_risk` | array | `['BTTS yes']` | Medium-risk set. |
| `risk_analysis.high_risk` | array | `['Correct score 3-2']` | High variance picks. |

---

Use these mappings to align probability semantics prior to feeding values into the ensemble weighting logic. Apply normalization rules described in `docs/ensemble-weight-strategy.md` and the configuration at `lib/config/prediction-ensemble-weights.json` to maintain consistency across sources.
