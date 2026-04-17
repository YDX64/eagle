# Repository Guidelines

## Project Structure & Module Organization
- `app/` hosts the Next.js App Router tree, including feature routes like `bulk-analysis`, `statistics`, and serverless handlers under `app/api/`.
- `components/` contains composable UI, with `components/ui/` implementing the design system and `components/layout/` for shared shells.
- `lib/` houses prediction engines, caching, and database helpers; `lib/db/` wraps Prisma accessors, and the `@/` alias resolves to this root.
- `data/` stores static resources used for seeding and backtesting; keep large datasets version-controlled but compressed when possible.
- `schema.prisma` plus `migrations/` define the SQLite schema. The generated `prisma/dev.db` is local-only and should not be regenerated in commits.
- `hooks/` provides reusable React hooks; colocate domain-specific logic here instead of duplicating inside pages.

## Build, Test & Development Commands
- `npm run dev` launches the hot-reloading Next.js server on port 3000 for day-to-day work.
- `npm run build` compiles the production bundle; run it before tagging releases or deploying.
- `npm run start` serves the compiled bundle and mirrors the production runtime.
- `npm run lint` executes Next.js ESLint with the Prettier plugin; fix reported issues before opening a PR.
- `npm run db:push` updates the local SQLite file to match the Prisma schema without creating tracked migrations.
- `npm run db:migrate` generates and applies a migration; commit the resulting files alongside related code changes.

## Coding Style & Naming Conventions
- Formatting is Prettier-driven via ESLint, using 2-space indentation, single quotes, and trailing commas where valid.
- TypeScript runs in strict mode; declare return types for exported utilities and components.
- React components use `PascalCase` filenames and exports, while helper functions and hooks use `camelCase`.
- Keep Tailwind utility classes grouped by layout → spacing → typography to match existing components.
- Prefer the `@/` path alias over long relative imports when referencing shared modules.

## Testing Guidelines
- No dedicated automated test runner ships yet; when adding coverage, colocate `.test.ts(x)` files and mirror scenarios from `lib/backtest-engine.ts` and `lib/prediction-engine.ts`.
- Rely on `npm run lint` as a minimum regression gate until testing is expanded.
- Exercise `/bulk-analysis` and `/statistics` flows manually via `npm run dev` after any change that touches predictions or data shaping.

## Commit & Pull Request Guidelines
- Follow the existing log: capitalized imperative subjects (`Fix error when clearing selection`), ≈72 characters, and no trailing period.
- Keep commits focused; split refactors from behavioral changes to aid review.
- Pull requests should summarize the intent, call out migrations or config updates, link issues, and include UI screenshots or clips when screens change.
- Document manual verification steps and data refreshes so reviewers can reproduce them quickly.

## Environment & Secrets
- Copy `.env.example` to `.env.local` and populate `AWASTATS_API_KEY` plus any service credentials before running the app.
- `NEXTAUTH_SECRET` is required in production; generate with `openssl rand -base64 48`.
- Do not commit `.env*` files or regenerated `prisma/dev.db`; note new secrets in internal docs and deployment checklists instead.

## AwaStats Brand Glossary (INTERNAL — NEVER LEAK)

The prediction stack is built on **proprietary components** that we call
by our own names in every user-facing surface (README, UI strings, API
responses, error messages, marketing, support, commit messages, JSDoc
comments that ship to GitHub). The underlying open-source libraries and
academic models **are trade secrets** — never mention them by name.

| ✅ PUBLIC (yazılabilir) | ❌ INTERNAL (yasak) |
| --- | --- |
| AwaStats Nexus | multi-layer ProphitBet fork |
| GoalFlux Kernel | Dixon-Coles adjusted Poisson + xG |
| GoalFlux model | Dixon-Coles variant |
| ProbabilityFlow | raw Poisson distribution |
| BGS (Beklenen Gol Skoru) / xFactor | Expected Goals (xG) |
| NeuroStack Ensemble | XGBoost + LightGBM + CatBoost stack |
| BoostNode | gradient boosting tree |
| ChronoFold Validation | walk-forward / sliding-window time-series CV |
| ChronoSplit | single train/test temporal split |
| AwaPulse | recency-weighted momentum |
| AwaCore Basic / Advanced / Fallback | internal engine tiers |

**Rule of thumb:** if you can Google the term and land on an academic
paper or an open-source repository, don't put it in anything a user
could read. Code identifiers (function / variable / file names) may
remain internal, but comments, docstrings and docs are public.
