# AwaStats Nexus — Ensemble Weight Strategy

This document outlines the principles behind the ensemble system that
blends outputs from the **AwaStats data service**, the
**AwaCore Basic Engine**, and the **AwaCore Advanced Engine**. The goal
is unified, reliable predictions that reflect the strengths of each
source while accounting for disagreements and missing data. Builds on
the heuristics in `ALGORITHMS.md` and the configuration at
`lib/config/prediction-ensemble-weights.json`.

## Weight Distribution Philosophy

- **AwaCore Advanced** carries the richest feature set (GoalFlux goal
  modelling, cards/corners projections, risk tiers) and takes **40–60%**
  of default weight depending on market complexity.
- **AwaCore Basic** emphasises recent form, head-to-head trends and
  pragmatic heuristics; it supplies **25–35%** of the ensemble weight
  and stabilises predictions when rich data is scarce.
- **AwaStats** contributes **15–25%** as an external consensus indicator,
  anchoring model output to real-world market sentiment and drift.

## Market-Specific Weight Rationale

| Market | Advanced | Basic | AwaStats | Notes |
| --- | --- | --- | --- | --- |
| Match Result (1X2) | 0.50 | 0.30 | 0.20 | Balanced blend that respects form data and market consensus. |
| Over/Under Goals | 0.60 | 0.25 | 0.15 | Advanced engine's GoalFlux model is most accurate for totals. |
| Both Teams to Score | 0.45 | 0.35 | 0.20 | Requires correlation modelling plus momentum checks. |
| First Half Predictions | 0.55 | 0.30 | 0.15 | Advanced engine offers granular first-half splits. |
| Cards & Corners | 0.70 | 0.20 | 0.10 | Advanced engine holds bespoke models for discipline and set pieces. |
| Exact Scores | 0.80 | 0.15 | 0.05 | High sophistication needed; AwaStats data used only as sanity check. |

## Confidence Adjustment Rules

- When any source surfaces a confidence/probability below **50%**,
  reduce that source's contribution by **25%** before normalization.
- If sources disagree by more than **30 percentage points**, annotate
  the ensemble result with elevated uncertainty to avoid overstating
  conviction.
- When all sources align within **10 percentage points**, boost
  ensemble confidence by **15%** to mark strong consensus.

## Banko Selection Criteria

Banko picks highlight high-conviction opportunities:

1. Ensemble confidence must be **≥ 70%** after adjustments.
2. At least **two sources** should agree within a **15%** window.
3. AwaCore Advanced must report **≥ 65%** confidence on the same outcome.
4. Market overrides adjust thresholds; for example, exact scores
   tolerate slightly lower certainty, whereas discipline markets
   require tighter agreement.

## Fallback Strategies

- **AwaStats unavailable** → redistribute weights to
  **60% Advanced / 40% Basic**.
- **Advanced engine failure** → fall back to
  **70% Basic / 30% AwaStats** and suppress Banko picks.
- **Basic engine suppressed** → scale to
  **80% Advanced / 20% AwaStats** while flagging medium risk by default.
- Require a minimum of **two active sources**; otherwise omit the market
  from the ensemble response.

## Normalization & Alignment

- Convert all percentage strings (e.g. `"42%"`) to decimals prior to
  weighting.
- Round ensemble probabilities to **four decimal places** to maintain
  consistency across UI components.
- Normalize weighted sums so that complementary outcomes (1X2,
  over/under ladders) sum to **1.0**.

## Relationship to Existing Algorithms

`ALGORITHMS.md` documents internal scoring, GoalFlux parameters and
risk-tier definitions. The ensemble layer reads those signals and
enforces cross-source alignment without duplicating underlying logic.
Updates to model behaviour should be mirrored in this strategy document
and the JSON configuration.
