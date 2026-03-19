#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

WEEK="$(date +%G-W%V)"
DATE_OVERRIDE=""
DRY_RUN=0
FORCE=0

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --week)
        WEEK="$2"
        shift 2
        ;;
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
  ./scripts/agent_daily_linkedin_publisher.sh --week 2026-W12 --date 2026-03-18
  ./scripts/agent_daily_linkedin_publisher.sh --dry-run

Behavior:
  - Loads the weekly plan from plans/YYYY-Www/plan.json
  - Finds the post scheduled for today or the supplied date
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

main() {
  parse_args "$@"

  local -a cmd=(node scripts/publish-daily-linkedin.js --week "$WEEK")
  [[ -n "$DATE_OVERRIDE" ]] && cmd+=(--date "$DATE_OVERRIDE")
  (( DRY_RUN == 1 )) && cmd+=(--dry-run)
  (( FORCE == 1 )) && cmd+=(--force)

  (cd "$REPO_DIR" && "${cmd[@]}")
}

main "$@"
