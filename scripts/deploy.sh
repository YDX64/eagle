#!/usr/bin/env bash
# GitOps deploy script — pull main, rebuild probet-app, smoke-test.
#
# Use this from AWAXX (or from the local machine via `ssh AWAXX "cd /opt/probet && bash scripts/deploy.sh"`).
# No rsync, no worktrees — only git pull + docker compose.
#
# Local workflow:
#   1. Make changes on the laptop
#   2. git add -A && git commit -m "..."
#   3. git push origin main
#   4. ssh AWAXX "cd /opt/probet && bash scripts/deploy.sh"
#
# The script is idempotent — re-running is safe.

set -euo pipefail

cd /opt/probet

# ── 1. Safe fetch + fast-forward only ────────────────────────────────────────
# Never force-push, never worktree, never rebase-with-prod-diffs. If main
# diverges from prod, the deploy aborts and a human has to reconcile.
git config --global --add safe.directory /opt/probet 2>/dev/null || true
git fetch --prune origin main
LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse '@{u}')
BASE=$(git merge-base @ '@{u}')

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "[deploy] already at $LOCAL — no git pull needed"
elif [ "$LOCAL" = "$BASE" ]; then
  echo "[deploy] fast-forwarding $LOCAL → $REMOTE"
  git merge --ff-only origin/main
elif [ "$REMOTE" = "$BASE" ]; then
  echo "[deploy] prod has commits not in main — aborting. Push prod's commits to main first."
  git log --oneline "$BASE..$LOCAL"
  exit 1
else
  echo "[deploy] branches diverged — aborting. Reconcile manually."
  git log --oneline --all --graph -10
  exit 1
fi

# ── 2. Rebuild the container (only when files actually changed) ──────────────
CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE" 2>/dev/null || echo 'force')
if [ "$LOCAL" = "$REMOTE" ] && [ "${1:-}" != "--force-build" ]; then
  echo "[deploy] no code changes. Pass --force-build to rebuild anyway."
else
  echo "[deploy] rebuilding probet-app…"
  docker compose up -d --build probet-app
fi

# ── 3. Wait for healthy ───────────────────────────────────────────────────────
echo "[deploy] waiting for probet-app health…"
for i in $(seq 1 60); do
  status=$(docker ps --filter name=probet-app --format '{{.Status}}' | head -1)
  if echo "$status" | grep -q healthy; then
    echo "[deploy] probet-app → $status"
    break
  fi
  if echo "$status" | grep -q Restarting; then
    echo "[deploy] probet-app is restarting — container logs:"
    docker logs probet-app --tail 30
    exit 2
  fi
  sleep 2
done

# ── 4. Smoke test ─────────────────────────────────────────────────────────────
echo "[deploy] smoke test…"
for path in / /tracking /tracking/fixtures /api/tracking/kpis /api/matches/today; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:5051$path" || echo 000)
  case "$code" in
    200|304) echo "  $path → $code ✓" ;;
    *)       echo "  $path → $code ✗"; EXIT=1 ;;
  esac
done
exit "${EXIT:-0}"
