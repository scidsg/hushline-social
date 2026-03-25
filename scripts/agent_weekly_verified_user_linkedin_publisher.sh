#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DATE_OVERRIDE=""
DRY_RUN=0
FORCE=0
WAIT_SECONDS="${HUSHLINE_SOCIAL_VERIFIED_USER_PUBLISH_WAIT_SECONDS:-600}"
WAIT_INTERVAL_SECONDS="${HUSHLINE_SOCIAL_VERIFIED_USER_PUBLISH_WAIT_INTERVAL_SECONDS:-5}"

require_positive_integer() {
  local value="$1"
  local name="$2"

  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value <= 0 )); then
    echo "$name must be a positive integer; got: $value" >&2
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --date)
        DATE_OVERRIDE="$2"
        shift 2
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --force)
        FORCE=1
        shift
        ;;
      --help|-h)
        cat <<'EOF'
Usage:
  ./scripts/agent_weekly_verified_user_linkedin_publisher.sh
  ./scripts/agent_weekly_verified_user_linkedin_publisher.sh --date 2026-03-30
  ./scripts/agent_weekly_verified_user_linkedin_publisher.sh --dry-run

Behavior:
  - Loads the archived weekly verified-user post from previous-verified-user-posts/YYYY-MM-DD
  - Publishes it to LinkedIn
  - Writes a local publication record to avoid duplicate posting
EOF
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        exit 1
        ;;
    esac
  done
}

effective_date() {
  if [[ -n "$DATE_OVERRIDE" ]]; then
    printf '%s\n' "$DATE_OVERRIDE"
    return
  fi

  date +%Y-%m-%d
}

wait_for_archive() {
  local publish_date=""
  local archive_dir=""
  local post_path=""
  local image_path=""
  local elapsed=0

  publish_date="$(effective_date)"
  archive_dir="$REPO_DIR/previous-verified-user-posts/$publish_date"
  post_path="$archive_dir/post.json"
  image_path="$archive_dir/social-card@2x.png"

  while [[ ! -f "$post_path" || ! -f "$image_path" ]]; do
    if (( elapsed >= WAIT_SECONDS )); then
      echo "Timed out waiting for verified-user archive files for $publish_date." >&2
      echo "Expected: $post_path and $image_path" >&2
      exit 1
    fi

    if (( elapsed == 0 )); then
      echo "Waiting for verified-user archive files for $publish_date..."
    fi

    sleep "$WAIT_INTERVAL_SECONDS"
    elapsed=$((elapsed + WAIT_INTERVAL_SECONDS))
  done
}

main() {
  parse_args "$@"
  require_positive_integer "$WAIT_SECONDS" "HUSHLINE_SOCIAL_VERIFIED_USER_PUBLISH_WAIT_SECONDS"
  require_positive_integer "$WAIT_INTERVAL_SECONDS" "HUSHLINE_SOCIAL_VERIFIED_USER_PUBLISH_WAIT_INTERVAL_SECONDS"
  wait_for_archive

  local -a cmd=(node scripts/publish-daily-linkedin.js --date-root previous-verified-user-posts --allow-weekend)
  [[ -n "$DATE_OVERRIDE" ]] && cmd+=(--date "$DATE_OVERRIDE")
  (( DRY_RUN == 1 )) && cmd+=(--dry-run)
  (( FORCE == 1 )) && cmd+=(--force)

  (cd "$REPO_DIR" && "${cmd[@]}")
}

main "$@"
