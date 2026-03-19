#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="${HOME}/Library/LaunchAgents"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

main() {
  require_cmd launchctl
  require_cmd sed

  mkdir -p "$TARGET_DIR"
  mkdir -p "$REPO_DIR/logs"

  install_agent \
    "$REPO_DIR/deploy/launchd/com.hushline.social.linkedin.daily.plist" \
    "$TARGET_DIR/com.hushline.social.linkedin.daily.plist" \
    "com.hushline.social.linkedin.daily"
  install_agent \
    "$REPO_DIR/deploy/launchd/com.hushline.social.weekly-planner.plist" \
    "$TARGET_DIR/com.hushline.social.weekly-planner.plist" \
    "com.hushline.social.weekly-planner"

  cat <<EOF
Installed launch agents:
- $TARGET_DIR/com.hushline.social.linkedin.daily.plist
- $TARGET_DIR/com.hushline.social.weekly-planner.plist

Logs:
- $REPO_DIR/logs/linkedin-daily.stdout.log
- $REPO_DIR/logs/linkedin-daily.stderr.log
- $REPO_DIR/logs/weekly-planner.stdout.log
- $REPO_DIR/logs/weekly-planner.stderr.log

Next steps:
- create $REPO_DIR/.env.launchd with LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN
- ensure git push auth and commit signing work for previous-posts archive pushes
- test with: launchctl kickstart -k gui/$(id -u)/com.hushline.social.linkedin.daily
- test with: launchctl kickstart -k gui/$(id -u)/com.hushline.social.weekly-planner
EOF
}

install_agent() {
  local template_path="$1"
  local target_plist="$2"
  local label="$3"

  sed "s#__REPO_DIR__#$REPO_DIR#g" "$template_path" > "$target_plist"
  launchctl bootout "gui/$(id -u)" "$target_plist" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$target_plist"
  launchctl enable "gui/$(id -u)/$label"
}

main "$@"
