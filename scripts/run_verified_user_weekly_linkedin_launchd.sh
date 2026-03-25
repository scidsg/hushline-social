#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCK_DIR="$REPO_DIR/.tmp/verified-user-weekly-linkedin.lock"
ENV_FILE="${HUSHLINE_SOCIAL_ENV_FILE:-$REPO_DIR/.env.launchd}"
COMBINED_LOG_FILE="${HUSHLINE_SOCIAL_COMBINED_LOG_FILE:-$REPO_DIR/logs/social-daily.log}"

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

if ! mkdir -p "$REPO_DIR/.tmp"; then
  echo "Failed to create temp directory under $REPO_DIR/.tmp" >&2
  exit 1
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Verified-user LinkedIn publisher is already running. Exiting." >&2
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
echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Starting verified-user LinkedIn publisher wrapper."

cd "$REPO_DIR"
./scripts/agent_weekly_verified_user_linkedin_publisher.sh "$@"
