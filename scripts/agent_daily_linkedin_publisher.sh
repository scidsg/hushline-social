#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DATE_OVERRIDE=""
DRY_RUN=0
FORCE=0

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
  ./scripts/agent_daily_linkedin_publisher.sh
  ./scripts/agent_daily_linkedin_publisher.sh --date 2026-03-18
  ./scripts/agent_daily_linkedin_publisher.sh --dry-run

Behavior:
  - Loads the archived daily post from previous-posts/YYYY-MM-DD
  - Finds the post for today or the supplied date
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

weekday_number() {
  date -j -f "%Y-%m-%d" "$1" "+%u"
}

skip_if_weekend() {
  local publish_date=""
  local weekday=""
  publish_date="$(effective_date)"
  weekday="$(weekday_number "$publish_date")"
  if [[ "$weekday" == "6" || "$weekday" == "7" ]]; then
    echo "Skipping daily LinkedIn publisher for weekend date $publish_date."
    exit 0
  fi
}

main() {
  parse_args "$@"
  skip_if_weekend

  local -a cmd=(node scripts/publish-daily-linkedin.js)
  [[ -n "$DATE_OVERRIDE" ]] && cmd+=(--date "$DATE_OVERRIDE")
  (( DRY_RUN == 1 )) && cmd+=(--dry-run)
  (( FORCE == 1 )) && cmd+=(--force)

  (cd "$REPO_DIR" && "${cmd[@]}")
}

main "$@"
