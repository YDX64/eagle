#!/usr/bin/env bash
# Sync local main <-> AWAXX prod. Use when prod has uncommitted file
# changes that need to be captured in the repo (e.g. hotfixes applied
# directly on /opt/probet). Pulls those diffs to the laptop, lets you
# review + commit, then redeploys.
#
# Workflow:
#   1. Shows prod vs origin/main diffs
#   2. Optionally scp's changed files back to the laptop
#   3. You run git diff / git add / git commit / git push
#   4. Run scripts/deploy.sh on prod for a clean redeploy
#
# Never force-push. Never overwrite. Never touch worktrees.

set -euo pipefail

echo "[sync] checking prod working tree..."
ssh AWAXX "cd /opt/probet && git config --global --add safe.directory /opt/probet 2>/dev/null; git fetch --quiet origin main; git status --short" || {
  echo "[sync] ssh/git failed. Check AWAXX connectivity and /opt/probet/.git state."
  exit 1
}

echo
echo "[sync] diff summary (prod HEAD vs origin/main):"
ssh AWAXX "cd /opt/probet && git diff --stat HEAD origin/main" || true

echo
read -r -p "Pull prod's drifted files onto laptop for review? [y/N] " ans
if [ "${ans,,}" != "y" ]; then
  echo "[sync] aborted. Nothing changed locally."
  exit 0
fi

LAPTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHANGED=$(ssh AWAXX "cd /opt/probet && git status --porcelain" | awk '{print $2}')
for path in $CHANGED; do
  [ -z "$path" ] && continue
  echo "[sync] fetching $path"
  mkdir -p "$LAPTOP_DIR/$(dirname "$path")"
  scp -q "AWAXX:/opt/probet/$path" "$LAPTOP_DIR/$path" || true
done

echo
echo "[sync] done. Review with:"
echo "  git diff"
echo "  git add -p"
echo "  git commit -m ..."
echo "  git push origin main"
echo "Then redeploy with:"
echo "  ssh AWAXX 'cd /opt/probet && bash scripts/deploy.sh'"
