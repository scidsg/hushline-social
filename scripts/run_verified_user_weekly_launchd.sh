#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCK_DIR="$REPO_DIR/.tmp/verified-user-weekly.lock"
ENV_FILE="${HUSHLINE_SOCIAL_ENV_FILE:-$REPO_DIR/.env.launchd}"
COMBINED_LOG_FILE="${HUSHLINE_SOCIAL_COMBINED_LOG_FILE:-$REPO_DIR/logs/social-daily.log}"
AUTO_GIT_PULL="${HUSHLINE_SOCIAL_GIT_PULL:-1}"
AUTO_GIT_CLEAN="${HUSHLINE_SOCIAL_GIT_CLEAN:-1}"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

cleanup() {
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
}

setup_log_capture() {
  mkdir -p "$(dirname "$COMBINED_LOG_FILE")"
  exec > >(tee -a "$COMBINED_LOG_FILE")
  exec 2> >(tee -a "$COMBINED_LOG_FILE" >&2)
}

effective_date() {
  local previous=""
  local arg=""

  for arg in "$@"; do
    if [[ "$previous" == "--date" ]]; then
      printf '%s\n' "$arg"
      return
    fi
    previous="$arg"
  done

  date +%Y-%m-%d
}

weekday_number() {
  date -j -f "%Y-%m-%d" "$1" "+%u"
}

skip_if_not_monday() {
  local target_date=""
  local weekday=""
  target_date="$(effective_date "$@")"
  weekday="$(weekday_number "$target_date")"
  if [[ "$weekday" != "1" ]]; then
    echo "Skipping verified-user weekly runner for non-Monday date $target_date."
    exit 0
  fi
}

update_repo() {
  if [[ "$AUTO_GIT_PULL" != "1" ]]; then
    echo "Automatic git pull skipped."
    return
  fi

  if [[ "$AUTO_GIT_CLEAN" == "1" ]]; then
    echo "Resetting tracked changes before weekly verified-user run."
    git -C "$REPO_DIR" reset --hard HEAD
    echo "Removing untracked files before weekly verified-user run."
    git -C "$REPO_DIR" clean -fd
  else
    if ! git -C "$REPO_DIR" diff --quiet --ignore-submodules HEAD --; then
      echo "Refusing to git pull with unstaged tracked changes in $REPO_DIR." >&2
      exit 1
    fi

    if ! git -C "$REPO_DIR" diff --cached --quiet --ignore-submodules --; then
      echo "Refusing to git pull with staged changes in $REPO_DIR." >&2
      exit 1
    fi

    if [[ -n "$(git -C "$REPO_DIR" ls-files --others --exclude-standard)" ]]; then
      echo "Refusing to git pull with untracked files in $REPO_DIR." >&2
      exit 1
    fi
  fi

  echo "Running git pull --ff-only before weekly verified-user run."
  git -C "$REPO_DIR" pull --ff-only
}

if ! mkdir -p "$REPO_DIR/.tmp"; then
  echo "Failed to create temp directory under $REPO_DIR/.tmp" >&2
  exit 1
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Verified-user weekly runner is already running. Exiting." >&2
  exit 0
fi
trap cleanup EXIT

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

setup_log_capture
echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Starting verified-user weekly wrapper."

skip_if_not_monday "$@"

update_repo

cd "$REPO_DIR"
./scripts/agent_weekly_verified_user_runner.sh "$@"
