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

resolve_tailscale_mode() {
  local mode="${MULMOTERMINAL_TAILSCALE_MODE:-}"
  if [[ -z "$mode" ]]; then
    if [[ "${MULMOTERMINAL_TAILSCALE_HTTP:-0}" == "1" ]]; then
      mode="http"
      tailscale_mode_source="legacy"
    else
      mode="auto"
      tailscale_mode_source="default"
    fi
  else
    tailscale_mode_source="mode"
  fi

  case "$mode" in
    tailscale)
      mode="https"
      ;;
    auto|https|http|local) ;;
    *)
      echo "[mulmoterminal] Invalid MULMOTERMINAL_TAILSCALE_MODE=${mode}" >&2
      echo "[mulmoterminal] Expected one of: auto, tailscale, https, http, local." >&2
      exit 1
      ;;
  esac

  tailscale_mode="$mode"
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
  local tailscale_mode="${3:-https}"
  local persist_mode="${4:-0}"
  local startup_mode="${5:-tailscale-serve}"
  local host origin
  local tmp_file

  echo ".env.local and ${target_file} were not found. Starting first-time setup."
  echo

  if [[ -n "$detected_host" ]]; then
    if [[ "$tailscale_mode" == "http" ]]; then
      echo "Detected Tailscale IPv4 address:"
    else
      echo "Detected Tailscale host:"
    fi
    echo "  ${detected_host}"
    echo
    if prompt_yes_no "Use this value? [Y/n]: " "y"; then
      host="$detected_host"
    else
      if [[ "$tailscale_mode" == "http" ]]; then
        host="$(prompt_required "Tailscale IPv4 address")"
      else
        host="$(prompt_required "Tailscale host")"
      fi
    fi
  elif [[ "$tailscale_mode" == "http" ]]; then
    host="$(prompt_required "Tailscale IPv4 address")"
  else
    host="$(prompt_required "Tailscale host")"
  fi

  if [[ "$tailscale_mode" == "http" ]]; then
    origin="http://${host}:${CLIENT_PORT:-6857}"
  else
    origin="https://${host}"
  fi

  tmp_file="$(mktemp)"
  {
    echo "# Generated by scripts/start-dev.sh"
    echo "# Shared by local MulmoTerminal worktrees on this machine."
  } > "$tmp_file"

  if [[ "$persist_mode" == "1" ]]; then
    if [[ "$startup_mode" == "tailscale-serve" ]]; then
      write_env_assignment "$tmp_file" "MULMOTERMINAL_TAILSCALE_MODE" "$tailscale_mode"
    else
      write_env_assignment "$tmp_file" "MULMOTERMINAL_MODE" "$startup_mode"
    fi
  fi
  write_env_assignment "$tmp_file" "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS" "$host"
  write_env_assignment "$tmp_file" "MULMOTERMINAL_ALLOWED_ORIGINS" "$origin"

  echo
  echo "Allowed origin:"
  echo "  ${origin}"
  echo

  if [[ "$tailscale_mode" == "http" ]]; then
    echo "[mulmoterminal] Web Push setup is skipped in HTTP mode because it requires a secure context." >&2
  else
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
  local tailscale_mode="$2"
  local persist_mode="$3"
  local startup_mode="${4:-tailscale-serve}"
  [[ "$tailscale_mode" != "local" ]] || return 0
  [[ "$default_env_files" == "1" ]] || return 0
  [[ ! -f "$LOCAL_ENV_FILE" ]] || return 0
  [[ -z "$USER_LOCAL_ENV_FILE" || ! -f "$USER_LOCAL_ENV_FILE" ]] || return 0

  if ! is_interactive; then
    return 0
  fi

  local target_file detected_host shell_host
  target_file="${USER_LOCAL_ENV_FILE:-$LOCAL_ENV_FILE}"
  if [[ "$tailscale_mode" == "http" ]]; then
    if [[ -n "${tailscale_ip:-}" ]]; then
      detected_host="$tailscale_ip"
    else
      detected_host="$(detect_tailscale_ip || true)"
    fi
  else
    shell_host="$(first_env_value "${__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS:-}")"
    [[ -n "$shell_host" ]] || shell_host="$(host_from_origin "${MULMOTERMINAL_ALLOWED_ORIGINS:-}")"
    detected_host="$(normalize_host "$shell_host")"
    if [[ -z "$detected_host" ]]; then
      detected_host="$(detect_tailscale_host || true)"
    fi
  fi
  setup_env_file "$target_file" "$detected_host" "$tailscale_mode" "$persist_mode" "$startup_mode"
}

env_files=()
using_default_env_files=0
if [[ -n "${MULMOTERMINAL_ENV_FILES:-}" ]]; then
  IFS=':' read -r -a env_files <<< "$MULMOTERMINAL_ENV_FILES"
else
  using_default_env_files=1
  env_files=("$ROOT_DIR/.env")
  env_files+=("$LOCAL_ENV_FILE")
  [[ -n "$USER_LOCAL_ENV_FILE" ]] && env_files+=("$USER_LOCAL_ENV_FILE")
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

resolve_startup_mode() {
  local mode="${MULMOTERMINAL_MODE:-}"
  startup_mode_source="mode"
  if [[ -z "$mode" ]]; then
    if [[ "${MULMOTERMINAL_LEGACY_TAILSCALE_ENTRYPOINT:-0}" == "1" ]]; then
      mode="tailscale-serve"
      startup_mode_source="compatibility-entrypoint"
    elif [[ -n "${MULMOTERMINAL_TAILSCALE_MODE:-}" || "${MULMOTERMINAL_TAILSCALE_HTTP:-0}" == "1" ]]; then
      if [[ "${MULMOTERMINAL_TAILSCALE_MODE:-}" == "local" ]]; then
        mode="local-only"
      else
        mode="tailscale-serve"
      fi
      startup_mode_source="legacy-env"
      echo "[mulmoterminal] MULMOTERMINAL_TAILSCALE_MODE is deprecated; use MULMOTERMINAL_MODE=${mode}." >&2
    else
      mode="nginx"
      startup_mode_source="default"
    fi
  fi

  case "$mode" in
    nginx|tailscale-serve|local-only) ;;
    *)
      echo "[mulmoterminal] Invalid MULMOTERMINAL_MODE=${mode}" >&2
      echo "[mulmoterminal] Expected one of: nginx, tailscale-serve, local-only." >&2
      exit 1
      ;;
  esac
  startup_mode="$mode"
}

tailscale_ip=""
tailscale_mode=""
tailscale_mode_source=""
startup_mode=""
startup_mode_source=""
effective_tailscale_mode="local"
resolve_startup_mode

configure_http_mode() {
  [[ -n "$tailscale_ip" ]] || tailscale_ip="$(detect_tailscale_ip)"
  export MULMOTERMINAL_TAILSCALE_SERVE=0
  export MULMOTERMINAL_VITE_HOST="${MULMOTERMINAL_VITE_HOST:-0.0.0.0}"
  export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="$tailscale_ip"
  export MULMOTERMINAL_ALLOWED_ORIGINS="http://${tailscale_ip}:${CLIENT_PORT}"
}

configure_local_mode() {
  export MULMOTERMINAL_TAILSCALE_SERVE=0
}

tailscale_path="${MULMOTERMINAL_TAILSCALE_PATH:-${MULMOTERMINAL_BASE_PATH%/}}"
[[ -n "$tailscale_path" ]] || tailscale_path="/"
tailscale_target_path="${MULMOTERMINAL_BASE_PATH%/}"
tailscale_target="${MULMOTERMINAL_TAILSCALE_TARGET:-http://localhost:${CLIENT_PORT}${tailscale_target_path}}"

run_tailscale_serve() {
  if [[ "${MULMOTERMINAL_TAILSCALE_SERVE:-1}" == "0" ]]; then
    return 0
  fi

  if [[ "${MULMOTERMINAL_START_DRY_RUN:-0}" == "1" ]]; then
    echo "tailscale serve --bg --set-path=${tailscale_path} ${tailscale_target}"
    return 0
  fi

  if ! command -v tailscale >/dev/null 2>&1; then
    echo "[mulmoterminal] tailscale CLI not found." >&2
    return 1
  fi

  local output
  if ! output="$(tailscale serve --bg --set-path="${tailscale_path}" "$tailscale_target" 2>&1)"; then
    [[ -z "$output" ]] || printf '%s\n' "$output" >&2
    return 1
  fi
  [[ -z "$output" ]] || printf '%s\n' "$output"
}

select_tailscale_mode() {
  case "$tailscale_mode" in
    local)
      configure_local_mode
      effective_tailscale_mode="local"
      ;;
    http)
      configure_http_mode
      effective_tailscale_mode="http"
      ;;
    https)
      if ! run_tailscale_serve; then
        echo "[mulmoterminal] Tailscale Serve could not be configured." >&2
        exit 1
      fi
      effective_tailscale_mode="https"
      ;;
    auto)
      if run_tailscale_serve; then
        effective_tailscale_mode="https"
        return 0
      fi

      echo "[mulmoterminal] Tailscale Serve could not be configured." >&2
      if ! tailscale_ip="$(detect_tailscale_ip)"; then
        echo "[mulmoterminal] Tailscale is not available; a Tailscale IPv4 address could not be detected." >&2
        if ! is_interactive; then
          echo "[mulmoterminal] Not prompting in a non-interactive shell." >&2
          echo "[mulmoterminal] Set MULMOTERMINAL_TAILSCALE_MODE=local to start without Tailscale." >&2
          exit 1
        fi
        if prompt_yes_no "Tailscale is not available. Start MulmoTerminal without Tailscale? [Y/n]: " "y"; then
          configure_local_mode
          effective_tailscale_mode="local"
          return 0
        fi
        echo "[mulmoterminal] Aborted because Tailscale is not available and local startup was declined." >&2
        exit 1
      fi

      if ! is_interactive; then
        echo "[mulmoterminal] Refusing to downgrade from HTTPS to HTTP without confirmation." >&2
        echo "[mulmoterminal] Set MULMOTERMINAL_TAILSCALE_MODE=http to use direct HTTP over the Tailscale VPN." >&2
        exit 1
      fi

      echo "[mulmoterminal] Direct HTTP access is limited to devices on your Tailscale VPN." >&2
      echo "[mulmoterminal] HTTP is not a secure context, so Web Push and other HTTPS-only browser features may be unavailable." >&2
      if prompt_yes_no "Tailscale Serve could not be configured. Use direct HTTP access over the Tailscale VPN instead? [Y/n]: " "y"; then
        configure_http_mode
        effective_tailscale_mode="http"
      else
        echo "[mulmoterminal] Aborted because Tailscale Serve could not be configured and HTTP fallback was declined." >&2
        exit 1
      fi
      ;;
  esac
}

persist_setup_mode=0
case "$startup_mode" in
  tailscale-serve)
    if [[ "$startup_mode_source" == "mode" && -z "${MULMOTERMINAL_TAILSCALE_MODE:-}" && "${MULMOTERMINAL_TAILSCALE_HTTP:-0}" != "1" ]]; then
      MULMOTERMINAL_TAILSCALE_MODE="https"
    fi
    resolve_tailscale_mode
    effective_tailscale_mode="$tailscale_mode"
    select_tailscale_mode
    if [[ "$tailscale_mode_source" != "default" || "$effective_tailscale_mode" == "http" ]]; then
      persist_setup_mode=1
    fi
    maybe_first_time_setup "$using_default_env_files" "$effective_tailscale_mode" "$persist_setup_mode" "$startup_mode"
    ;;
  nginx)
    configure_local_mode
    maybe_first_time_setup "$using_default_env_files" "https" "1" "$startup_mode"
    ;;
  local-only)
    configure_local_mode
    ;;
esac

for env_file in "${env_files[@]}"; do
  [[ -n "$env_file" ]] && load_env_file "$env_file"
done

MULMOTERMINAL_BASE_PATH="$(normalize_base_path "$MULMOTERMINAL_BASE_PATH")"

if [[ "$effective_tailscale_mode" == "http" ]]; then
  configure_http_mode
elif [[ "$effective_tailscale_mode" == "local" ]]; then
  configure_local_mode
fi

configure_nginx() {
  local setup_script="${ROOT_DIR}/scripts/setup-nginx-https.sh"
  local detected_host status nginx_root sudo_bin

  if [[ -z "${MULMOTERMINAL_NGINX_SERVER_NAME:-}" ]]; then
    detected_host="$(host_from_origin "${MULMOTERMINAL_ALLOWED_ORIGINS:-}")"
    [[ -n "$detected_host" ]] || detected_host="$(first_env_value "${__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS:-}")"
    if [[ -n "$detected_host" ]]; then
      export MULMOTERMINAL_NGINX_SERVER_NAME="$detected_host"
    fi
  fi

  if [[ "${MULMOTERMINAL_START_DRY_RUN:-0}" == "1" ]]; then
    MULMOTERMINAL_NGINX_DRY_RUN=1 "$setup_script"
    return 0
  fi

  if "$setup_script" --check; then
    echo "[mulmoterminal] nginx configuration is already current."
    return 0
  else
    status=$?
  fi
  if [[ "$status" != "10" ]]; then
    echo "[mulmoterminal] Could not inspect the nginx configuration." >&2
    return "$status"
  fi

  nginx_root="${MULMOTERMINAL_NGINX_ROOT:-/etc/nginx}"
  if [[ "${MULMOTERMINAL_NGINX_USE_SUDO:-auto}" == "0" || "${EUID}" == "0" ]] || can_setup_nginx_without_sudo "$nginx_root"; then
    "$setup_script"
    return 0
  fi

  sudo_bin="${MULMOTERMINAL_SUDO_BIN:-sudo}"
  if ! command -v "$sudo_bin" >/dev/null 2>&1; then
    echo "[mulmoterminal] nginx setup needs privileged writes, but sudo was not found." >&2
    return 1
  fi
  "$sudo_bin" --preserve-env "$setup_script"
}

writable_or_creatable_directory() {
  local path="$1"
  while [[ ! -e "$path" ]]; do
    local parent
    parent="$(dirname -- "$path")"
    [[ "$parent" != "$path" ]] || return 1
    path="$parent"
  done
  [[ -d "$path" && -w "$path" ]]
}

can_setup_nginx_without_sudo() {
  local nginx_root="$1"
  local conf_d snippets sites_available sites_enabled validation_stamp mode server_conf
  conf_d="${MULMOTERMINAL_NGINX_CONF_D:-${nginx_root}/conf.d}"
  snippets="${MULMOTERMINAL_NGINX_SNIPPETS:-${nginx_root}/snippets}"
  sites_available="${MULMOTERMINAL_NGINX_SITES_AVAILABLE:-${nginx_root}/sites-available}"
  sites_enabled="${MULMOTERMINAL_NGINX_SITES_ENABLED:-${nginx_root}/sites-enabled}"
  validation_stamp="${MULMOTERMINAL_NGINX_VALIDATION_STAMP:-${nginx_root}/.mulmoterminal-nginx-validated}"
  mode="${MULMOTERMINAL_NGINX_MODE:-existing}"
  server_conf="${MULMOTERMINAL_NGINX_SERVER_CONF:-}"

  writable_or_creatable_directory "$conf_d" || return 1
  writable_or_creatable_directory "$snippets" || return 1
  writable_or_creatable_directory "$(dirname -- "$validation_stamp")" || return 1
  if [[ "$mode" == "new" ]]; then
    writable_or_creatable_directory "$sites_available" || return 1
    writable_or_creatable_directory "$sites_enabled" || return 1
  elif [[ -n "$server_conf" && ! -w "$server_conf" ]]; then
    return 1
  fi
}

if [[ "$startup_mode" == "nginx" ]]; then
  configure_nginx
fi

echo "[mulmoterminal] backend PORT=${PORT}"
echo "[mulmoterminal] vite CLIENT_PORT=${CLIENT_PORT}"
echo "[mulmoterminal] base path ${MULMOTERMINAL_BASE_PATH}"
echo "[mulmoterminal] mobile mode ${MULMOTERMINAL_MOBILE_MODE}"
echo "[mulmoterminal] startup mode ${startup_mode}"
if [[ "$startup_mode" == "tailscale-serve" ]]; then
  echo "[mulmoterminal] tailscale mode ${effective_tailscale_mode}"
fi
echo "[mulmoterminal] local URL http://localhost:${CLIENT_PORT}${MULMOTERMINAL_BASE_PATH}"
if [[ "$effective_tailscale_mode" == "http" && -n "${tailscale_ip:-}" ]]; then
  echo "[mulmoterminal] Tailscale HTTP URL http://${tailscale_ip}:${CLIENT_PORT}${MULMOTERMINAL_BASE_PATH}"
elif [[ "$effective_tailscale_mode" == "https" ]]; then
  echo "[mulmoterminal] Tailscale Serve path ${tailscale_path}"
elif [[ "$effective_tailscale_mode" == "local" ]]; then
  echo "[mulmoterminal] Tailscale disabled; no Tailscale DNS, IP, or serve route is required."
fi

if [[ "${MULMOTERMINAL_START_DRY_RUN:-0}" == "1" ]]; then
  echo "PORT=${PORT} CLIENT_PORT=${CLIENT_PORT} MULMOTERMINAL_BASE_PATH=${MULMOTERMINAL_BASE_PATH} MULMOTERMINAL_MOBILE_MODE=${MULMOTERMINAL_MOBILE_MODE}${tailscale_ip:+ MULMOTERMINAL_VITE_HOST=${MULMOTERMINAL_VITE_HOST} MULMOTERMINAL_ALLOWED_ORIGINS=${MULMOTERMINAL_ALLOWED_ORIGINS}} yarn dev"
  exit 0
fi

cd "$ROOT_DIR"
exec yarn dev
