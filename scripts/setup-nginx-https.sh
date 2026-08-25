#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/setup-nginx-https.sh [options]

Creates nginx reverse-proxy config for MulmoTerminal over HTTPS.

Options:
  --mode existing|new        existing: add an include to an existing TLS server.
                             new: create a MulmoTerminal HTTPS server.
  --server-conf PATH         Existing nginx server file to receive the include.
  --server-name HOST         HTTPS host name, normally the Tailscale MagicDNS FQDN.
  --base-path PATH           Browser base path. Default: MULMOTERMINAL_BASE_PATH or /mulmoterminal/.
  --upstream URL             Local HTTP upstream. Default: http://127.0.0.1:${CLIENT_PORT}/<base-path>.
  --cert-file PATH           TLS certificate for --mode new.
  --key-file PATH            TLS private key for --mode new.
  --dry-run                  Print planned files and commands without writing.
  --check                    Exit 0 when current, 10 when setup changes are needed.
  --no-reload                Run nginx -t but do not reload.
  -h, --help                 Show this help.

Environment variables mirror the long option names:
  MULMOTERMINAL_NGINX_MODE
  MULMOTERMINAL_NGINX_SERVER_CONF
  MULMOTERMINAL_NGINX_SERVER_NAME
  MULMOTERMINAL_NGINX_BASE_PATH
  MULMOTERMINAL_NGINX_UPSTREAM
  MULMOTERMINAL_NGINX_CERT_FILE
  MULMOTERMINAL_NGINX_KEY_FILE
  MULMOTERMINAL_NGINX_DRY_RUN
  MULMOTERMINAL_NGINX_RELOAD

Testing/advanced path overrides:
  MULMOTERMINAL_NGINX_BIN
  MULMOTERMINAL_NGINX_ROOT
  MULMOTERMINAL_NGINX_CONF_D
  MULMOTERMINAL_NGINX_SNIPPETS
  MULMOTERMINAL_NGINX_SITES_AVAILABLE
  MULMOTERMINAL_NGINX_SITES_ENABLED
EOF
}

MODE="${MULMOTERMINAL_NGINX_MODE:-existing}"
SERVER_CONF="${MULMOTERMINAL_NGINX_SERVER_CONF:-}"
SERVER_NAME="${MULMOTERMINAL_NGINX_SERVER_NAME:-}"
BASE_PATH="${MULMOTERMINAL_NGINX_BASE_PATH:-${MULMOTERMINAL_BASE_PATH:-/mulmoterminal/}}"
UPSTREAM="${MULMOTERMINAL_NGINX_UPSTREAM:-}"
CERT_FILE="${MULMOTERMINAL_NGINX_CERT_FILE:-}"
KEY_FILE="${MULMOTERMINAL_NGINX_KEY_FILE:-}"
DRY_RUN="${MULMOTERMINAL_NGINX_DRY_RUN:-0}"
RELOAD="${MULMOTERMINAL_NGINX_RELOAD:-1}"
CHECK_ONLY=0
CHANGED=0
NGINX_BIN="${MULMOTERMINAL_NGINX_BIN:-nginx}"
NGINX_ROOT="${MULMOTERMINAL_NGINX_ROOT:-/etc/nginx}"
CONF_D="${MULMOTERMINAL_NGINX_CONF_D:-${NGINX_ROOT}/conf.d}"
SNIPPETS_DIR="${MULMOTERMINAL_NGINX_SNIPPETS:-${NGINX_ROOT}/snippets}"
SITES_AVAILABLE="${MULMOTERMINAL_NGINX_SITES_AVAILABLE:-${NGINX_ROOT}/sites-available}"
SITES_ENABLED="${MULMOTERMINAL_NGINX_SITES_ENABLED:-${NGINX_ROOT}/sites-enabled}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --server-conf)
      SERVER_CONF="${2:-}"
      shift 2
      ;;
    --server-name)
      SERVER_NAME="${2:-}"
      shift 2
      ;;
    --base-path)
      BASE_PATH="${2:-}"
      shift 2
      ;;
    --upstream)
      UPSTREAM="${2:-}"
      shift 2
      ;;
    --cert-file)
      CERT_FILE="${2:-}"
      shift 2
      ;;
    --key-file)
      KEY_FILE="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --check)
      CHECK_ONLY=1
      shift
      ;;
    --no-reload)
      RELOAD=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[mulmoterminal] Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

normalize_base_path() {
  local raw="${1:-/}"
  raw="${raw%%\?*}"
  raw="${raw%%#*}"
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"
  if [[ -z "$raw" || "$raw" == "/" ]]; then
    printf '/\n'
    return 0
  fi
  raw="/${raw#/}"
  raw="${raw%/}/"
  printf '%s\n' "$raw"
}

detect_tailscale_host() {
  command -v tailscale >/dev/null 2>&1 || return 1
  command -v node >/dev/null 2>&1 || return 1

  local status_json
  status_json="$(tailscale status --json 2>/dev/null)" || return 1
  node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (input += chunk));
    process.stdin.on("end", () => {
      try {
        const status = JSON.parse(input);
        const self = status.Self || status.self || status.LocalNode || status.LocalClient || {};
        const dns = String(self.DNSName || self.DnsName || self.dnsName || "").replace(/\.$/, "");
        if (!dns) process.exit(1);
        process.stdout.write(dns);
      } catch {
        process.exit(1);
      }
    });
  ' <<< "$status_json"
}

BASE_PATH="$(normalize_base_path "$BASE_PATH")"
BASE_PREFIX="${BASE_PATH%/}"
[[ -n "$BASE_PREFIX" ]] || BASE_PREFIX="/"
if [[ -z "$UPSTREAM" ]]; then
  UPSTREAM="http://127.0.0.1:${CLIENT_PORT:-6857}${BASE_PATH}"
fi

if [[ -z "$SERVER_NAME" ]]; then
  SERVER_NAME="$(detect_tailscale_host || true)"
fi

detect_existing_server_conf() {
  local candidate resolved
  [[ -n "$SERVER_NAME" ]] || return 1
  for candidate in "$SITES_ENABLED"/* "$SITES_AVAILABLE"/* "$CONF_D"/*.conf "$NGINX_ROOT/nginx.conf"; do
    [[ -f "$candidate" ]] || continue
    grep -Eq 'listen[^;]*443' "$candidate" || continue
    if grep -E 'server_name[^;]*' "$candidate" | grep -qF "$SERVER_NAME"; then
      resolved="$(readlink -f -- "$candidate" 2>/dev/null || true)"
      printf '%s\n' "${resolved:-$candidate}"
      return 0
    fi
  done
  return 1
}

if [[ "$MODE" == "existing" && -z "$SERVER_CONF" ]]; then
  SERVER_CONF="$(detect_existing_server_conf || true)"
fi

case "$MODE" in
  existing|new) ;;
  *)
    echo "[mulmoterminal] Invalid --mode ${MODE}; expected existing or new." >&2
    exit 2
    ;;
esac

MAP_FILE="${CONF_D}/mulmoterminal-websocket-map.conf"
LOCATION_FILE="${SNIPPETS_DIR}/mulmoterminal-location.conf"
SERVER_FILE="${SITES_AVAILABLE}/mulmoterminal.conf"
SERVER_LINK="${SITES_ENABLED}/mulmoterminal.conf"

location_config() {
  if [[ "$BASE_PATH" != "/" ]]; then
    cat <<EOF
location = ${BASE_PREFIX} {
    return 308 ${BASE_PATH};
}

EOF
  fi
  cat <<EOF
location ${BASE_PATH} {
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host \$host;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$mulmoterminal_connection_upgrade;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
    proxy_buffering off;
    proxy_pass ${UPSTREAM};
}
EOF
}

map_config() {
  cat <<'EOF'
map $http_upgrade $mulmoterminal_connection_upgrade {
    default upgrade;
    '' close;
}
EOF
}

server_config() {
  cat <<EOF
server {
    listen 80;
    server_name ${SERVER_NAME};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${SERVER_NAME};

    ssl_certificate ${CERT_FILE};
    ssl_certificate_key ${KEY_FILE};

    include ${LOCATION_FILE};
}
EOF
}

print_file() {
  local file="$1"
  echo "[mulmoterminal] would write ${file}:"
  sed 's/^/  /'
}

write_if_changed() {
  local file="$1"
  local mode="${2:-0644}"
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp"

  if [[ -f "$file" ]] && cmp -s "$tmp" "$file"; then
    [[ "$CHECK_ONLY" == "1" ]] || echo "[mulmoterminal] unchanged ${file}"
    rm -f "$tmp"
    return 0
  fi

  CHANGED=1
  if [[ "$CHECK_ONLY" == "1" ]]; then
    rm -f "$tmp"
    return 0
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    print_file "$file" < "$tmp"
    rm -f "$tmp"
    return 0
  fi

  mkdir -p "$(dirname -- "$file")"
  install -m "$mode" "$tmp" "$file"
  rm -f "$tmp"
  echo "[mulmoterminal] wrote ${file}"
}

install_include_once() {
  local server_conf="$1"
  local include_file="$2"
  local marker_begin="# BEGIN MulmoTerminal managed include"
  local marker_end="# END MulmoTerminal managed include"
  local block
  block="    ${marker_begin}
    include ${include_file};
    ${marker_end}"

  if [[ -z "$server_conf" ]]; then
    echo "[mulmoterminal] --server-conf is required in existing mode." >&2
    echo "[mulmoterminal] Pass the nginx file that contains the existing HTTPS server block." >&2
    exit 2
  fi
  if [[ ! -f "$server_conf" && "$DRY_RUN" != "1" ]]; then
    echo "[mulmoterminal] server conf does not exist: ${server_conf}" >&2
    exit 1
  fi

  if grep -qF "$marker_begin" "$server_conf" 2>/dev/null && grep -qF "include ${include_file};" "$server_conf" 2>/dev/null; then
    [[ "$CHECK_ONLY" == "1" ]] || echo "[mulmoterminal] include already present in ${server_conf}"
    return 0
  fi

  CHANGED=1
  if [[ "$CHECK_ONLY" == "1" ]]; then
    return 0
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[mulmoterminal] would add this include to ${server_conf} if missing:"
    printf '%s\n' "$block" | sed 's/^/  /'
    return 0
  fi

  local tmp backup
  tmp="$(mktemp)"
  if grep -qF "$marker_begin" "$server_conf"; then
    if ! awk -v block="$block" -v marker_begin="$marker_begin" -v marker_end="$marker_end" '
      index($0, marker_begin) {
        print block
        replacing = 1
        next
      }
      replacing && index($0, marker_end) {
        replacing = 0
        next
      }
      !replacing { print }
      END { if (replacing) exit 2 }
    ' "$server_conf" > "$tmp"; then
      rm -f "$tmp"
      echo "[mulmoterminal] managed include block is incomplete in ${server_conf}; not editing it." >&2
      exit 1
    fi
  elif ! awk -v block="$block" -v server_name="$SERVER_NAME" '
    function brace_delta(value, copy, opens, closes) {
      copy = value
      opens = gsub(/\{/, "{", copy)
      copy = value
      closes = gsub(/\}/, "}", copy)
      return opens - closes
    }
    {
      if (!in_server && $0 ~ /^[[:space:]]*server[[:space:]]*\{/) {
        in_server = 1
        depth = 0
        has_443 = 0
        has_name = server_name == ""
      }

      delta = in_server ? brace_delta($0) : 0
      if (in_server) {
        if ($0 ~ /listen[^;]*443/) has_443 = 1
        if (server_name != "" && $0 ~ /server_name/ && index($0, server_name) > 0) has_name = 1
        if (!inserted && has_443 && has_name && depth + delta == 0) {
          print block
          inserted = 1
        }
      }

      print

      if (in_server) {
        depth += delta
        if (depth == 0) in_server = 0
      }
    }
    END {
      if (!inserted) exit 2
    }
  ' "$server_conf" > "$tmp"; then
    rm -f "$tmp"
    echo "[mulmoterminal] could not find the target HTTPS server block in ${server_conf}; not editing it." >&2
    echo "[mulmoterminal] Check --server-name or add the include manually inside the existing 443 server." >&2
    exit 1
  fi

  backup="${server_conf}.bak.$(date +%Y%m%d%H%M%S)"
  cp -p "$server_conf" "$backup"
  install -m 0644 "$tmp" "$server_conf"
  rm -f "$tmp"
  echo "[mulmoterminal] backed up ${server_conf} to ${backup}"
  echo "[mulmoterminal] added MulmoTerminal include to ${server_conf}"
}

ensure_nginx_available() {
  if command -v "$NGINX_BIN" >/dev/null 2>&1; then
    return 0
  fi
  echo "[mulmoterminal] nginx was not found." >&2
  echo "[mulmoterminal] Install and enable nginx, then rerun this script:" >&2
  echo "  Debian/Ubuntu: sudo apt update && sudo apt install nginx && sudo systemctl enable --now nginx" >&2
  echo "  Fedora/RHEL:   sudo dnf install nginx && sudo systemctl enable --now nginx" >&2
  echo "  macOS/Homebrew: brew install nginx && brew services start nginx" >&2
  exit 1
}

validate_new_mode_inputs() {
  if [[ -z "$SERVER_NAME" ]]; then
    echo "[mulmoterminal] --server-name is required in new mode when Tailscale DNS detection is unavailable." >&2
    exit 2
  fi
  CERT_FILE="${CERT_FILE:-/etc/ssl/mulmoterminal/${SERVER_NAME}.crt}"
  KEY_FILE="${KEY_FILE:-/etc/ssl/mulmoterminal/${SERVER_NAME}.key}"
  if [[ "$DRY_RUN" == "1" ]]; then
    return 0
  fi
  if [[ ! -f "$CERT_FILE" || ! -f "$KEY_FILE" ]]; then
    echo "[mulmoterminal] TLS certificate files are missing:" >&2
    echo "  cert: ${CERT_FILE}" >&2
    echo "  key:  ${KEY_FILE}" >&2
    echo "[mulmoterminal] For a Tailscale MagicDNS name, enable HTTPS certificates in the Tailscale admin console and run:" >&2
    echo "  sudo mkdir -p /etc/ssl/mulmoterminal" >&2
    echo "  sudo tailscale cert --cert-file ${CERT_FILE} --key-file ${KEY_FILE} ${SERVER_NAME}" >&2
    exit 1
  fi
}

test_and_reload() {
  if [[ "$CHANGED" == "0" ]]; then
    echo "[mulmoterminal] nginx configuration is already current; test and reload skipped"
    return 0
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[mulmoterminal] would run: ${NGINX_BIN} -t"
    if [[ "$RELOAD" == "1" ]]; then
      echo "[mulmoterminal] would run after successful test: ${NGINX_BIN} -s reload"
    fi
    return 0
  fi

  ensure_nginx_available
  if ! "$NGINX_BIN" -t; then
    echo "[mulmoterminal] nginx -t failed; nginx was not reloaded." >&2
    exit 1
  fi
  if [[ "$RELOAD" == "1" ]]; then
    "$NGINX_BIN" -s reload
    echo "[mulmoterminal] nginx reloaded"
  else
    echo "[mulmoterminal] nginx -t passed; reload skipped"
  fi
}

echo "[mulmoterminal] nginx HTTPS mode ${MODE}"
echo "[mulmoterminal] base path ${BASE_PATH}"
echo "[mulmoterminal] upstream ${UPSTREAM}"

write_if_changed "$MAP_FILE" < <(map_config)
write_if_changed "$LOCATION_FILE" < <(location_config)

if [[ "$MODE" == "existing" ]]; then
  install_include_once "$SERVER_CONF" "$LOCATION_FILE"
else
  validate_new_mode_inputs
  write_if_changed "$SERVER_FILE" < <(server_config)
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[mulmoterminal] would enable ${SERVER_FILE} at ${SERVER_LINK}"
    CHANGED=1
  elif [[ "$CHECK_ONLY" == "1" ]]; then
    if [[ ! -L "$SERVER_LINK" || "$(readlink "$SERVER_LINK" 2>/dev/null || true)" != "$SERVER_FILE" ]]; then
      CHANGED=1
    fi
  else
    mkdir -p "$SITES_ENABLED"
    if [[ -L "$SERVER_LINK" ]]; then
      if [[ "$(readlink "$SERVER_LINK")" == "$SERVER_FILE" ]]; then
        echo "[mulmoterminal] enable link already present ${SERVER_LINK}"
      else
        ln -sfn "$SERVER_FILE" "$SERVER_LINK"
        CHANGED=1
        echo "[mulmoterminal] updated enable link ${SERVER_LINK}"
      fi
    elif [[ -e "$SERVER_LINK" ]]; then
      echo "[mulmoterminal] refusing to replace non-symlink ${SERVER_LINK}" >&2
      exit 1
    else
      ln -s "$SERVER_FILE" "$SERVER_LINK"
      CHANGED=1
      echo "[mulmoterminal] enabled ${SERVER_LINK}"
    fi
  fi
fi

if [[ "$CHECK_ONLY" == "1" ]]; then
  if [[ "$CHANGED" == "1" ]]; then
    exit 10
  fi
  exit 0
fi

test_and_reload

if [[ -n "$SERVER_NAME" ]]; then
  echo "[mulmoterminal] browser URL https://${SERVER_NAME}${BASE_PATH}"
else
  echo "[mulmoterminal] browser URL https://<your-existing-nginx-host>${BASE_PATH}"
fi
echo "[mulmoterminal] start MulmoTerminal with:"
echo "  MULMOTERMINAL_MODE=nginx MULMOTERMINAL_BASE_PATH=${BASE_PATH} MULMOTERMINAL_ALLOWED_ORIGINS=https://${SERVER_NAME:-<your-existing-nginx-host>} ./scripts/start-dev.sh"
