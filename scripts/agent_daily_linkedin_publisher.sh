#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DATE_OVERRIDE=""
DRY_RUN=0
FORCE=0
NO_PUSH=0

archive_already_pushed() {
  local publish_date=""
  local remote="${HUSHLINE_SOCIAL_ARCHIVE_REMOTE:-origin}"
  local branch="${HUSHLINE_SOCIAL_ARCHIVE_BRANCH:-main}"
  local archive_path=""
  local remote_ref=""

  if (( FORCE == 1 )); then
    return
  fi

  publish_date="$(effective_date)"
  archive_path="previous-posts/$publish_date/post.json"
  remote_ref="refs/remotes/$remote/$branch"

  if ! git -C "$REPO_DIR" fetch --quiet "$remote" "$branch:$remote_ref"; then
    echo "Failed to refresh $remote/$branch before checking daily publication state." >&2
    exit 1
  fi

  if git -C "$REPO_DIR" cat-file -e "${remote}/${branch}:${archive_path}" 2>/dev/null; then
    echo "Daily archive for $publish_date is already present on $remote/$branch; skipping publish."
    exit 0
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
      --no-push)
        NO_PUSH=1
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
  - Pushes the dated archive folder after successful publication
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

push_archive() {
  if (( NO_PUSH == 1 )) || [[ "${HUSHLINE_SOCIAL_ARCHIVE_PUSH:-1}" != "1" ]]; then
    echo "Archive push skipped."
    return
  fi

  (cd "$REPO_DIR" && ./scripts/push_previous_posts_archive.sh --date "$(effective_date)")
}

main() {
  parse_args "$@"
  skip_if_weekend
  archive_already_pushed

  local -a cmd=(node scripts/publish-daily-linkedin.js)
  [[ -n "$DATE_OVERRIDE" ]] && cmd+=(--date "$DATE_OVERRIDE")
  (( DRY_RUN == 1 )) && cmd+=(--dry-run)
  (( FORCE == 1 )) && cmd+=(--force)

  (cd "$REPO_DIR" && "${cmd[@]}")

  if (( DRY_RUN == 0 )); then
    push_archive
  fi
}

main "$@"
