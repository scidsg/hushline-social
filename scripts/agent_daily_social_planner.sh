#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCREENSHOTS_REPO_DIR="${HUSHLINE_SCREENSHOTS_REPO_DIR:-$(cd "$REPO_DIR/.." && pwd)/hushline-screenshots}"
SCREENSHOT_MAX_AGE_DAYS="${HUSHLINE_SCREENSHOT_MAX_AGE_DAYS:-21}"
SCREENSHOT_AUTO_SYNC="${HUSHLINE_SCREENSHOT_AUTO_SYNC:-1}"
SCREENSHOT_REMOTE_CHECK_ATTEMPTS="${HUSHLINE_SCREENSHOT_REMOTE_CHECK_ATTEMPTS:-3}"
SCREENSHOT_REMOTE_CHECK_TIMEOUT_SECONDS="${HUSHLINE_SCREENSHOT_REMOTE_CHECK_TIMEOUT_SECONDS:-12}"
ALLOW_STALE_SCREENSHOTS="${HUSHLINE_ALLOW_STALE_SCREENSHOTS:-0}"
ARCHIVE_PUSH_ENABLED="${HUSHLINE_SOCIAL_DAILY_PUSH_ON_RENDER:-0}"

DATE="$(date +%Y-%m-%d)"
CANDIDATE_COUNT=""
DARK_RATIO=""
NO_RENDER=0
NO_PUSH=0
FORCE_PUSH=0

CODEX_MODEL="${CODEX_MODEL:-gpt-5.4}"
CODEX_REASONING_EFFORT="${CODEX_REASONING_EFFORT:-high}"
VERBOSE_CODEX_OUTPUT="${VERBOSE_CODEX_OUTPUT:-0}"

PROMPT_FILE="$(mktemp)"
CODEX_OUTPUT_FILE="$(mktemp)"
CODEX_TRANSCRIPT_FILE="$(mktemp)"

cleanup() {
  rm -f "$PROMPT_FILE" "$CODEX_OUTPUT_FILE" "$CODEX_TRANSCRIPT_FILE"
}
trap cleanup EXIT

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
      --candidate-count)
        CANDIDATE_COUNT="$2"
        shift 2
        ;;
      --dark-ratio)
        DARK_RATIO="$2"
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
      --push-render-archive)
        FORCE_PUSH=1
        shift
        ;;
      --help|-h)
        cat <<'EOF'
Usage:
  ./scripts/agent_daily_social_planner.sh --date 2026-03-19

Behavior:
  - Prepares daily context and prompt artifacts under previous-posts/YYYY-MM-DD
  - Invokes Codex CLI in the local repo
  - Expects Codex to write previous-posts/YYYY-MM-DD/plan.json
  - Validates the plan and renders assets
  - Keeps the daily archive local by default
  - Pushes the daily archive only when --push-render-archive is passed or HUSHLINE_SOCIAL_DAILY_PUSH_ON_RENDER=1
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

weekday_number() {
  date -j -f "%Y-%m-%d" "$1" "+%u"
}

skip_if_weekend() {
  local weekday=""
  weekday="$(weekday_number "$DATE")"
  if [[ "$weekday" == "6" || "$weekday" == "7" ]]; then
    echo "Skipping daily social planner for weekend date $DATE."
    exit 0
  fi
}

build_context() {
  local -a cmd=(node scripts/plan-day.js --date "$DATE")
  [[ -n "$CANDIDATE_COUNT" ]] && cmd+=(--candidate-count "$CANDIDATE_COUNT")
  [[ -n "$DARK_RATIO" ]] && cmd+=(--dark-ratio "$DARK_RATIO")

  "${cmd[@]}"
}

reset_day_plan_artifacts() {
  rm -f "$REPO_DIR/previous-posts/$DATE/plan.json"
}

run_codex_from_prompt() {
  local rc=0
  : > "$CODEX_OUTPUT_FILE"
  : > "$CODEX_TRANSCRIPT_FILE"

  if [[ "$VERBOSE_CODEX_OUTPUT" == "1" ]]; then
    echo "Codex execution started; streaming transcript to console."
  else
    echo "Codex execution started; transcript captured to a temporary file."
  fi

  set +e
  codex exec \
    --model "$CODEX_MODEL" \
    -c "model_reasoning_effort=\"$CODEX_REASONING_EFFORT\"" \
    --full-auto \
    --sandbox workspace-write \
    -C "$REPO_DIR" \
    -o "$CODEX_OUTPUT_FILE" \
    - < "$PROMPT_FILE" 2>&1 | {
      if [[ "$VERBOSE_CODEX_OUTPUT" == "1" ]]; then
        tee "$CODEX_TRANSCRIPT_FILE"
      else
        cat > "$CODEX_TRANSCRIPT_FILE"
      fi
    }
  rc=${PIPESTATUS[0]}
  set -e

  if (( rc != 0 )); then
    echo "Codex execution failed (exit ${rc})." >&2
    return "$rc"
  fi

  echo "Codex execution completed."
  if [[ -s "$CODEX_OUTPUT_FILE" ]]; then
    echo "Codex final message:"
    sed -n '1,60p' "$CODEX_OUTPUT_FILE"
    printf '\n'
  fi
}

validate_and_render() {
  local -a cmd=(node scripts/validate-day-plan.js --date "$DATE")
  [[ -n "$CANDIDATE_COUNT" ]] && cmd+=(--candidate-count "$CANDIDATE_COUNT")
  [[ -n "$DARK_RATIO" ]] && cmd+=(--dark-ratio "$DARK_RATIO")
  (( NO_RENDER == 1 )) && cmd+=(--no-render)

  "${cmd[@]}"
}

push_archive() {
  if (( NO_PUSH == 1 )); then
    echo "Archive push skipped."
    return
  fi

  if (( FORCE_PUSH == 0 )) && [[ "$ARCHIVE_PUSH_ENABLED" != "1" ]]; then
    echo "Archive push skipped."
    return
  fi

  ./scripts/push_previous_posts_archive.sh --date "$DATE"
}

verify_screenshot_source() {
  local manifest_path="$SCREENSHOTS_REPO_DIR/releases/latest/manifest.json"
  local local_release=""
  local local_captured_at=""
  local age_days=""

  if [[ ! -d "$SCREENSHOTS_REPO_DIR/.git" ]]; then
    echo "Missing screenshots repo checkout: $SCREENSHOTS_REPO_DIR" >&2
    exit 1
  fi

  if [[ ! -f "$manifest_path" ]]; then
    echo "Missing latest screenshots manifest: $manifest_path" >&2
    exit 1
  fi

  local_release="$(node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(m.release || ""));' "$manifest_path")"
  local_captured_at="$(node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(m.capturedAt || ""));' "$manifest_path")"
  age_days="$(node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const captured=new Date(m.capturedAt); const age=Math.floor((Date.now()-captured.getTime())/86400000); process.stdout.write(String(age));' "$manifest_path")"

  echo "Latest screenshots manifest: release=${local_release:-unknown} captured_at=${local_captured_at:-unknown} age_days=$age_days"

  if [[ "$ALLOW_STALE_SCREENSHOTS" != "1" ]] && [[ "$age_days" =~ ^[0-9]+$ ]] && (( age_days > SCREENSHOT_MAX_AGE_DAYS )); then
    echo "Latest screenshots manifest is older than ${SCREENSHOT_MAX_AGE_DAYS} days." >&2
    echo "Set HUSHLINE_ALLOW_STALE_SCREENSHOTS=1 to override intentionally." >&2
    exit 1
  fi

  echo "Checking upstream latest screenshots manifest."
  if remote_manifest_matches_local "$manifest_path"; then
    echo "Local latest screenshots manifest matches upstream."
    return
  fi

  if [[ "$SCREENSHOT_AUTO_SYNC" == "1" ]]; then
    echo "Local latest screenshots manifest is stale. Syncing upstream latest snapshot."
    node "$REPO_DIR/scripts/sync-latest-screenshots.js" --dest "$SCREENSHOTS_REPO_DIR/releases/latest"

    if remote_manifest_matches_local "$manifest_path"; then
      echo "Local latest screenshots folder synced to upstream."
      return
    fi

    echo "Automatic latest screenshot sync did not produce an upstream-matching manifest." >&2
    exit 1
  fi

  if [[ "$ALLOW_STALE_SCREENSHOTS" == "1" ]]; then
    echo "Warning: local latest screenshots manifest does not match upstream, but continuing because HUSHLINE_ALLOW_STALE_SCREENSHOTS=1."
    return
  fi

  echo "Local latest screenshots manifest does not match upstream and automatic sync is disabled." >&2
  exit 1
}

remote_manifest_matches_local() {
  local manifest_path="$1"
  local attempt=""
  local probe_file=""
  local probe_pid=""
  local timed_out=0
  local rc=0
  local local_release=""
  local local_captured_at=""
  local remote_manifest=""
  local remote_release=""
  local remote_captured_at=""

  local_release="$(node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(m.release || ""));' "$manifest_path")"
  local_captured_at="$(node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(m.capturedAt || ""));' "$manifest_path")"

  for ((attempt = 1; attempt <= SCREENSHOT_REMOTE_CHECK_ATTEMPTS; attempt += 1)); do
    probe_file="$(mktemp)"
    (
      curl -sL https://raw.githubusercontent.com/scidsg/hushline-screenshots/main/releases/latest/manifest.json >"$probe_file" 2>&1
    ) &
    probe_pid=$!
    timed_out=0

    for ((i = 0; i < SCREENSHOT_REMOTE_CHECK_TIMEOUT_SECONDS; i += 1)); do
      if ! kill -0 "$probe_pid" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done

    if kill -0 "$probe_pid" >/dev/null 2>&1; then
      timed_out=1
      kill "$probe_pid" >/dev/null 2>&1 || true
      wait "$probe_pid" >/dev/null 2>&1 || true
    else
      set +e
      wait "$probe_pid"
      rc=$?
      set -e
    fi

    if (( timed_out == 0 )) && (( rc == 0 )) && [[ -s "$probe_file" ]]; then
      remote_manifest="$(cat "$probe_file")"
      rm -f "$probe_file"
      remote_release="$(printf '%s' "$remote_manifest" | node -e 'let data=""; process.stdin.on("data",(chunk)=>data+=chunk); process.stdin.on("end",()=>{const m=JSON.parse(data); process.stdout.write(String(m.release || ""));});')"
      remote_captured_at="$(printf '%s' "$remote_manifest" | node -e 'let data=""; process.stdin.on("data",(chunk)=>data+=chunk); process.stdin.on("end",()=>{const m=JSON.parse(data); process.stdout.write(String(m.capturedAt || ""));});')"
      [[ "$local_release" == "$remote_release" && "$local_captured_at" == "$remote_captured_at" ]]
      return $?
    fi

    if (( attempt < SCREENSHOT_REMOTE_CHECK_ATTEMPTS )); then
      sleep 1
    fi

    rm -f "$probe_file"
  done

  return 1
}

main() {
  parse_args "$@"
  skip_if_weekend

  require_cmd codex
  require_cmd node

  echo "Runner Codex config: model=$CODEX_MODEL reasoning_effort=$CODEX_REASONING_EFFORT verbose_codex_output=$VERBOSE_CODEX_OUTPUT"

  verify_screenshot_source
  build_context
  reset_day_plan_artifacts

  cp "$REPO_DIR/previous-posts/$DATE/prompt.txt" "$PROMPT_FILE"
  run_codex_from_prompt
  validate_and_render
  push_archive
}

main "$@"
