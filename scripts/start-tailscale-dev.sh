#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# Compatibility entrypoint: keep the historical Tailscale-first default while
# allowing MULMOTERMINAL_MODE to select one of the new startup modes.
export MULMOTERMINAL_LEGACY_TAILSCALE_ENTRYPOINT=1
exec "${ROOT_DIR}/scripts/start-dev.sh" "$@"
