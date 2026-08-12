#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

declare -A ORIGINAL_ENV=()
while IFS= read -r name; do
  ORIGINAL_ENV["$name"]=1
done < <(compgen -v)

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0

  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]] || continue

    key="${BASH_REMATCH[2]}"
    [[ -n "${ORIGINAL_ENV[$key]+x}" ]] && continue

    value="${BASH_REMATCH[3]}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ ( "$value" == \"*\" && "$value" == *\" ) || ( "$value" == \'*\' && "$value" == *\' ) ]]; then
      value="${value:1:${#value}-2}"
    fi

    printf -v "$key" '%s' "$value"
    export "$key"
  done < "$file"
}

env_files=()
if [[ -n "${MULMOTERMINAL_ENV_FILES:-}" ]]; then
  IFS=':' read -r -a env_files <<< "$MULMOTERMINAL_ENV_FILES"
else
  env_files=("$ROOT_DIR/.env" "$ROOT_DIR/.env.local")
fi

for env_file in "${env_files[@]}"; do
  [[ -n "$env_file" ]] && load_env_file "$env_file"
done

normalize_base_path() {
  local raw="${1:-/}"
  if [[ "$raw" == "/" ]]; then
    printf '/\n'
    return 0
  fi
  raw="/${raw#/}"
  raw="${raw%/}/"
  printf '%s\n' "$raw"
}

export PORT="${PORT:-34568}"
export CLIENT_PORT="${CLIENT_PORT:-6857}"
export MULMOTERMINAL_BASE_PATH
MULMOTERMINAL_BASE_PATH="$(normalize_base_path "${MULMOTERMINAL_BASE_PATH:-/mulmoterminal/}")"
export MULMOTERMINAL_MOBILE_MODE="${MULMOTERMINAL_MOBILE_MODE:-local}"

tailscale_path="${MULMOTERMINAL_TAILSCALE_PATH:-${MULMOTERMINAL_BASE_PATH%/}}"
[[ -n "$tailscale_path" ]] || tailscale_path="/"
tailscale_target_path="${MULMOTERMINAL_BASE_PATH%/}"
tailscale_target="${MULMOTERMINAL_TAILSCALE_TARGET:-http://localhost:${CLIENT_PORT}${tailscale_target_path}}"

echo "[mulmoterminal] backend PORT=${PORT}"
echo "[mulmoterminal] vite CLIENT_PORT=${CLIENT_PORT}"
echo "[mulmoterminal] base path ${MULMOTERMINAL_BASE_PATH}"
echo "[mulmoterminal] mobile mode ${MULMOTERMINAL_MOBILE_MODE}"

if [[ "${MULMOTERMINAL_TAILSCALE_SERVE:-1}" != "0" ]]; then
  if [[ "${MULMOTERMINAL_START_DRY_RUN:-0}" == "1" ]]; then
    echo "tailscale serve --bg --set-path=${tailscale_path} ${tailscale_target}"
  else
    if ! command -v tailscale >/dev/null 2>&1; then
      echo "[mulmoterminal] tailscale CLI not found; install Tailscale or set MULMOTERMINAL_TAILSCALE_SERVE=0 to skip route setup." >&2
      exit 1
    fi
    tailscale serve --bg --set-path="${tailscale_path}" "$tailscale_target"
  fi
fi

if [[ "${MULMOTERMINAL_START_DRY_RUN:-0}" == "1" ]]; then
  echo "PORT=${PORT} CLIENT_PORT=${CLIENT_PORT} MULMOTERMINAL_BASE_PATH=${MULMOTERMINAL_BASE_PATH} MULMOTERMINAL_MOBILE_MODE=${MULMOTERMINAL_MOBILE_MODE} yarn dev"
  exit 0
fi

cd "$ROOT_DIR"
exec yarn dev
