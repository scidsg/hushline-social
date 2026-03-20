#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCK_DIR="$REPO_DIR/.tmp/daily-planner.lock"
ENV_FILE="${HUSHLINE_SOCIAL_ENV_FILE:-$REPO_DIR/.env.launchd}"
AUTO_GIT_PULL="${HUSHLINE_SOCIAL_GIT_PULL:-1}"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

cleanup() {
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
}

update_repo() {
  if [[ "$AUTO_GIT_PULL" != "1" ]]; then
    echo "Automatic git pull skipped."
    return
  fi

  if ! git -C "$REPO_DIR" diff --quiet --ignore-submodules HEAD --; then
    echo "Refusing to git pull with unstaged tracked changes in $REPO_DIR." >&2
    exit 1
  fi

  if ! git -C "$REPO_DIR" diff --cached --quiet --ignore-submodules --; then
    echo "Refusing to git pull with staged changes in $REPO_DIR." >&2
    exit 1
  fi

  echo "Running git pull --ff-only before daily planning."
  git -C "$REPO_DIR" pull --ff-only
}

if ! mkdir -p "$REPO_DIR/.tmp"; then
  echo "Failed to create temp directory under $REPO_DIR/.tmp" >&2
  exit 1
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Daily social planner is already running. Exiting." >&2
  exit 0
fi
trap cleanup EXIT

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

update_repo

cd "$REPO_DIR"
./scripts/agent_daily_social_planner.sh "$@"
