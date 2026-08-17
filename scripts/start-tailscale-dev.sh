#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_ENV_FILE="${ROOT_DIR}/.env.local"
if [[ -n "${MULMOTERMINAL_LOCAL_ENV_FILE:-}" ]]; then
  USER_LOCAL_ENV_FILE="$MULMOTERMINAL_LOCAL_ENV_FILE"
elif [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
  USER_LOCAL_ENV_FILE="${XDG_CONFIG_HOME}/mulmoterminal/local.env"
elif [[ -n "${HOME:-}" ]]; then
  USER_LOCAL_ENV_FILE="${HOME}/.config/mulmoterminal/local.env"
else
  USER_LOCAL_ENV_FILE=""
fi

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

is_interactive() {
  [[ "${MULMOTERMINAL_START_FORCE_INTERACTIVE:-0}" == "1" ]] && return 0
  [[ -t 0 && -t 1 ]]
}

first_env_value() {
  local value="${1:-}"
  value="${value%%,*}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s\n' "$value"
}

host_from_origin() {
  local value
  value="$(first_env_value "${1:-}")"
  value="${value#http://}"
  value="${value#https://}"
  value="${value%%/*}"
  value="${value%%:*}"
  printf '%s\n' "$value"
}

normalize_host() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value#http://}"
  value="${value#https://}"
  value="${value%%/*}"
  value="${value%%:*}"
  value="${value%.}"
  printf '%s\n' "$value"
}

detect_tailscale_host() {
  if ! command -v tailscale >/dev/null 2>&1; then
    echo "[mulmoterminal] Tailscale CLI was not found; enter the host manually." >&2
    return 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "[mulmoterminal] Node.js was not found; cannot parse Tailscale status, enter the host manually." >&2
    return 1
  fi

  local status_json host
  if ! status_json="$(tailscale status --json 2>/dev/null)"; then
    echo "[mulmoterminal] Could not read Tailscale status; make sure Tailscale is running, then enter the host manually." >&2
    return 1
  fi

  host="$(
    node -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => (input += chunk));
      process.stdin.on("end", () => {
        try {
          const status = JSON.parse(input);
          const self = status.Self || status.self || status.LocalNode || status.LocalClient || {};
          const dns = self.DNSName || self.DnsName || self.dnsName || "";
          process.stdout.write(String(dns).replace(/\.$/, ""));
        } catch {
          process.exitCode = 1;
        }
      });
    ' <<< "$status_json"
  )"

  if [[ -z "$host" ]]; then
    echo "[mulmoterminal] Tailscale status did not include a local DNS name; enter the host manually." >&2
    return 1
  fi

  normalize_host "$host"
}

detect_tailscale_ip() {
  if ! command -v tailscale >/dev/null 2>&1; then
    echo "[mulmoterminal] Tailscale CLI was not found; enter the Tailscale IPv4 address manually." >&2
    return 1
  fi

  local ip
  if ! ip="$(tailscale ip -4 2>/dev/null)"; then
    echo "[mulmoterminal] Could not read the Tailscale IPv4 address; make sure Tailscale is running, then enter it manually." >&2
    return 1
  fi

  ip="${ip%%$'\n'*}"
  ip="$(normalize_host "$ip")"
  if [[ ! "$ip" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
    echo "[mulmoterminal] Tailscale did not return a valid IPv4 address; enter it manually." >&2
    return 1
  fi
  printf '%s\n' "$ip"
}

prompt_yes_no() {
  local prompt="$1"
  local default="${2:-y}"
  local answer
  while true; do
    read -r -p "$prompt" answer
    answer="${answer:-$default}"
    case "${answer,,}" in
      y|yes) return 0 ;;
      n|no) return 1 ;;
      *) echo "Please answer y or n." >&2 ;;
    esac
  done
}

prompt_required() {
  local label="$1"
  local default="${2:-}"
  local value
  while true; do
    if [[ -n "$default" ]]; then
      read -r -p "${label} [${default}]: " value
      value="${value:-$default}"
    else
      read -r -p "${label}: " value
    fi
    value="$(normalize_host "$value")"
    if [[ -n "$value" ]]; then
      printf '%s\n' "$value"
      return 0
    fi
    echo "A value is required." >&2
  done
}

valid_web_push_subject() {
  local value="${1:-}"
  [[ "$value" == mailto:* || "$value" == https://* ]]
}

prompt_web_push_subject() {
  local default="$1"
  local value
  echo "Web Push subject was not found." >&2
  if [[ -n "$default" ]] && prompt_yes_no "Use ${default}? [Y/n]: " "y"; then
    printf '%s\n' "$default"
    return 0
  fi
  while true; do
    read -r -p "Web Push subject (mailto:... or https://...): " value
    if valid_web_push_subject "$value"; then
      printf '%s\n' "$value"
      return 0
    fi
    echo "Web Push subject must start with mailto: or https://." >&2
  done
}

generate_vapid_key_pair() {
  local generated
  if ! generated="$(
    cd "$ROOT_DIR" && node -e '
      const webPush = require("web-push");
      const keys = webPush.generateVAPIDKeys();
      process.stdout.write(`${keys.publicKey}\n${keys.privateKey}\n`);
    '
  )"; then
    echo "[mulmoterminal] Could not generate Web Push keys; Web Push will remain disabled." >&2
    return 1
  fi
  public_key="${generated%%$'\n'*}"
  private_key="${generated#*$'\n'}"
  private_key="${private_key%%$'\n'*}"
  [[ -n "$public_key" && -n "$private_key" ]]
}

configure_web_push() {
  local target_file="$1"
  local tmp_file="$2"
  local default_subject="$3"
  local public_key="${MULMOTERMINAL_MOBILE_WEB_PUSH_PUBLIC_KEY:-}"
  local private_key="${MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY:-}"
  local subject="${MULMOTERMINAL_MOBILE_WEB_PUSH_SUBJECT:-}"
  local generated_keys=0

  if [[ -n "$public_key" && -n "$private_key" ]]; then
    if [[ -n "$subject" ]]; then
      return 0
    fi
    subject="$(prompt_web_push_subject "$default_subject")"
    if [[ -z "${ORIGINAL_ENV[MULMOTERMINAL_MOBILE_WEB_PUSH_SUBJECT]+x}" ]]; then
      write_env_assignment "$tmp_file" "MULMOTERMINAL_MOBILE_WEB_PUSH_SUBJECT" "$subject"
    fi
    return 0
  fi

  if [[ -n "$public_key" || -n "$private_key" ]]; then
    echo "[mulmoterminal] Incomplete Web Push key settings were found; leaving Web Push disabled." >&2
    echo "[mulmoterminal] Set both MULMOTERMINAL_MOBILE_WEB_PUSH_PUBLIC_KEY and MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY to enable it." >&2
    return 0
  fi

  echo "Web Push keys were not found."
  if prompt_yes_no "Generate Web Push keys automatically? [Y/n]: " "y"; then
    if generate_vapid_key_pair; then
      generated_keys=1
      write_env_assignment "$tmp_file" "MULMOTERMINAL_MOBILE_WEB_PUSH_PUBLIC_KEY" "$public_key"
      write_env_assignment "$tmp_file" "MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY" "$private_key"
    fi
  else
    echo "[mulmoterminal] Web Push can be added later in ${target_file}."
    return 0
  fi

  [[ "$generated_keys" == "1" ]] || return 0

  if [[ -z "$subject" ]]; then
    subject="$(prompt_web_push_subject "$default_subject")"
  fi
  if [[ "$generated_keys" == "1" || -z "${ORIGINAL_ENV[MULMOTERMINAL_MOBILE_WEB_PUSH_SUBJECT]+x}" ]]; then
    write_env_assignment "$tmp_file" "MULMOTERMINAL_MOBILE_WEB_PUSH_SUBJECT" "$subject"
  fi
}

write_env_assignment() {
  local file="$1"
  local key="$2"
  local value="$3"
  [[ -n "$value" ]] || return 0
  printf '%s=%s\n' "$key" "$value" >> "$file"
}

setup_env_file() {
  local target_file="$1"
  local detected_host="${2:-}"
  local host origin
  local tmp_file

  echo ".env.local and ${target_file} were not found. Starting first-time setup."
  echo

  if [[ -n "$detected_host" ]]; then
    echo "Detected Tailscale host:"
    echo "  ${detected_host}"
    echo
    if prompt_yes_no "Use this host? [Y/n]: " "y"; then
      host="$detected_host"
    else
      host="$(prompt_required "Tailscale host")"
    fi
  else
    host="$(prompt_required "Tailscale host")"
  fi

  if [[ "${MULMOTERMINAL_TAILSCALE_HTTP:-0}" == "1" ]]; then
    origin="http://${host}:${CLIENT_PORT:-6857}"
  else
    origin="https://${host}"
  fi

  tmp_file="$(mktemp)"
  {
    echo "# Generated by scripts/start-tailscale-dev.sh"
    echo "# Shared by local MulmoTerminal worktrees on this machine."
  } > "$tmp_file"

  write_env_assignment "$tmp_file" "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS" "$host"
  write_env_assignment "$tmp_file" "MULMOTERMINAL_ALLOWED_ORIGINS" "$origin"

  echo
  echo "Allowed origin:"
  echo "  ${origin}"
  echo

  if [[ "${MULMOTERMINAL_TAILSCALE_HTTP:-0}" != "1" ]]; then
    configure_web_push "$target_file" "$tmp_file" "$origin"
  fi

  mkdir -p "$(dirname -- "$target_file")"
  install -m 600 "$tmp_file" "$target_file"
  rm -f "$tmp_file"

  echo
  echo "Created:"
  echo "  ${target_file}"
  echo
  echo "Starting MulmoTerminal..."
  echo
}

maybe_first_time_setup() {
  local default_env_files="$1"
  [[ "$default_env_files" == "1" ]] || return 0
  [[ ! -f "$LOCAL_ENV_FILE" ]] || return 0
  [[ -z "$USER_LOCAL_ENV_FILE" || ! -f "$USER_LOCAL_ENV_FILE" ]] || return 0

  if ! is_interactive; then
    return 0
  fi

  local target_file detected_host shell_host
  target_file="${USER_LOCAL_ENV_FILE:-$LOCAL_ENV_FILE}"
  if [[ "${MULMOTERMINAL_TAILSCALE_HTTP:-0}" == "1" ]]; then
    detected_host="$(detect_tailscale_ip || true)"
  else
    shell_host="$(first_env_value "${__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS:-}")"
    [[ -n "$shell_host" ]] || shell_host="$(host_from_origin "${MULMOTERMINAL_ALLOWED_ORIGINS:-}")"
    detected_host="$(normalize_host "$shell_host")"
    if [[ -z "$detected_host" ]]; then
      detected_host="$(detect_tailscale_host || true)"
    fi
  fi
  setup_env_file "$target_file" "$detected_host"
}

env_files=()
using_default_env_files=0
if [[ -n "${MULMOTERMINAL_ENV_FILES:-}" ]]; then
  IFS=':' read -r -a env_files <<< "$MULMOTERMINAL_ENV_FILES"
else
  using_default_env_files=1
  env_files=("$ROOT_DIR/.env")
  [[ -n "$USER_LOCAL_ENV_FILE" ]] && env_files+=("$USER_LOCAL_ENV_FILE")
  env_files+=("$LOCAL_ENV_FILE")
fi

if [[ "$using_default_env_files" == "1" ]]; then
  load_env_file "$ROOT_DIR/.env"
fi

maybe_first_time_setup "$using_default_env_files"

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

tailscale_ip=""
if [[ "${MULMOTERMINAL_TAILSCALE_HTTP:-0}" == "1" ]]; then
  tailscale_ip="$(detect_tailscale_ip)"
  export MULMOTERMINAL_TAILSCALE_SERVE=0
  export MULMOTERMINAL_VITE_HOST="${MULMOTERMINAL_VITE_HOST:-0.0.0.0}"
  export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="$tailscale_ip"
  export MULMOTERMINAL_ALLOWED_ORIGINS="http://${tailscale_ip}:${CLIENT_PORT}"
fi

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
  echo "PORT=${PORT} CLIENT_PORT=${CLIENT_PORT} MULMOTERMINAL_BASE_PATH=${MULMOTERMINAL_BASE_PATH} MULMOTERMINAL_MOBILE_MODE=${MULMOTERMINAL_MOBILE_MODE}${tailscale_ip:+ MULMOTERMINAL_VITE_HOST=${MULMOTERMINAL_VITE_HOST} MULMOTERMINAL_ALLOWED_ORIGINS=${MULMOTERMINAL_ALLOWED_ORIGINS}} yarn dev"
  exit 0
fi

cd "$ROOT_DIR"
exec yarn dev
