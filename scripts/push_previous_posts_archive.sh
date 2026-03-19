#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATE=""
BRANCH="${HUSHLINE_SOCIAL_ARCHIVE_BRANCH:-main}"
REMOTE="${HUSHLINE_SOCIAL_ARCHIVE_REMOTE:-origin}"
DRY_RUN=0

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --date)
        DATE="$2"
        shift 2
        ;;
      --branch)
        BRANCH="$2"
        shift 2
        ;;
      --remote)
        REMOTE="$2"
        shift 2
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --help|-h)
        cat <<'EOF'
Usage:
  ./scripts/push_previous_posts_archive.sh --date 2026-03-19

Behavior:
  - stages previous-posts/YYYY-MM-DD only
  - creates one archive commit
  - force-pushes the current HEAD to the configured remote branch with --force-with-lease
EOF
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        exit 1
        ;;
    esac
  done

  if [[ ! "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "--date must use YYYY-MM-DD format." >&2
    exit 1
  fi
}

main() {
  parse_args "$@"
  require_cmd git

  local archive_dir="$REPO_DIR/previous-posts/$DATE"
  local archive_rel="previous-posts/$DATE"
  local current_branch=""
  if [[ ! -d "$archive_dir" ]]; then
    echo "Archive folder not found: $archive_dir" >&2
    exit 1
  fi

  cd "$REPO_DIR"
  current_branch="$(git branch --show-current)"
  if [[ "$current_branch" != "$BRANCH" ]]; then
    echo "Refusing to push: current branch is '$current_branch', expected '$BRANCH'." >&2
    exit 1
  fi

  git add -- "$archive_rel"

  if git diff --cached --quiet -- "$archive_rel"; then
    echo "No staged archive changes for $archive_rel."
    exit 0
  fi

  local commit_message="Archive social post for $DATE"

  if (( DRY_RUN == 1 )); then
    echo "Dry run: would commit $archive_rel and push HEAD to $REMOTE/$BRANCH with --force-with-lease."
    exit 0
  fi

  git commit -m "$commit_message" -- "$archive_rel"
  git push -u --force-with-lease "$REMOTE" "HEAD:$BRANCH"
}

main "$@"
