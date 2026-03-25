#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ARCHIVE_PUSH_ENABLED="${HUSHLINE_SOCIAL_ARCHIVE_PUSH:-1}"

DATE="$(date +%Y-%m-%d)"
SOURCE=""
BASE_URL=""
NO_RENDER=0
NO_PUSH=0

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --date)
        DATE="$2"
        shift 2
        ;;
      --source)
        SOURCE="$2"
        shift 2
        ;;
      --base-url)
        BASE_URL="$2"
        shift 2
        ;;
      --no-render)
        NO_RENDER=1
        shift
        ;;
      --no-push)
        NO_PUSH=1
        shift
        ;;
      --help|-h)
        cat <<'EOF'
Usage:
  ./scripts/agent_weekly_verified_user_runner.sh --date 2026-03-30

Behavior:
  - Builds one verified-user social card for the requested Monday
  - Reads a verified directory JSON file or URL
  - Renders the selected user's URL and QR code into previous-verified-user-posts/YYYY-MM-DD
  - Optionally stages, commits, and pushes that weekly archive folder
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

build_post() {
  local -a cmd=(node scripts/render-verified-user-post.js --date "$DATE")
  [[ -n "$SOURCE" ]] && cmd+=(--source "$SOURCE")
  [[ -n "$BASE_URL" ]] && cmd+=(--base-url "$BASE_URL")
  (( NO_RENDER == 1 )) && cmd+=(--no-render)

  "${cmd[@]}"
}

push_archive() {
  if (( NO_PUSH == 1 )) || [[ "$ARCHIVE_PUSH_ENABLED" != "1" ]]; then
    echo "Archive push skipped."
    return
  fi

  ./scripts/push_previous_posts_archive.sh --date "$DATE" --archive-root previous-verified-user-posts
}

main() {
  parse_args "$@"
  cd "$REPO_DIR"
  build_post
  push_archive
}

main "$@"
