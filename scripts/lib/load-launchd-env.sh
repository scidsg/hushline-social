#!/usr/bin/env bash

resolve_launchd_env_file() {
  local repo_dir="$1"
  local requested_env_file="${HUSHLINE_SOCIAL_ENV_FILE:-}"
  local default_env_file="$repo_dir/.env.launchd"

  if [[ -n "$requested_env_file" ]]; then
    if [[ -f "$requested_env_file" ]]; then
      printf '%s\n' "$requested_env_file"
      return
    fi

    if [[ -f "$default_env_file" ]]; then
      echo "Warning: HUSHLINE_SOCIAL_ENV_FILE points to a missing file: $requested_env_file" >&2
      echo "Falling back to repo-local env file: $default_env_file" >&2
      printf '%s\n' "$default_env_file"
      return
    fi

    printf '%s\n' "$requested_env_file"
    return
  fi

  printf '%s\n' "$default_env_file"
}

load_launchd_env_file() {
  local repo_dir="$1"
  local env_file=""

  env_file="$(resolve_launchd_env_file "$repo_dir")"
  export HUSHLINE_SOCIAL_ENV_FILE="$env_file"

  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
  fi
}
