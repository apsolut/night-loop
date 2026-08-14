#!/usr/bin/env sh
# Locate bun, then run a sibling hook. Claude on Windows invokes hooks through
# Git Bash, whose PATH often omits nvm and ~/.bun installs.
set -eu

HOOK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
HOOK=${1:-}
if [ -z "$HOOK" ]; then
  echo "night-loop: with-bun.sh requires a hook file name" >&2
  exit 2
fi
shift

find_bun() {
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi
  for candidate in \
    "${BUN_INSTALL:-}/bin/bun" \
    "${BUN_INSTALL:-}/bin/bun.exe" \
    "${HOME}/.bun/bin/bun" \
    "${HOME}/.bun/bin/bun.exe"
  do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  nvm_home=${NVM_HOME:-${HOME}/AppData/Roaming/nvm}
  if [ -d "$nvm_home" ]; then
    for candidate in "$nvm_home"/*/node_modules/bun/bin/bun.exe; do
      if [ -x "$candidate" ]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done
  fi
  echo "night-loop: bun not found on PATH or in known install locations" >&2
  exit 127
}

BUN=$(find_bun)
exec "$BUN" "$HOOK_DIR/$HOOK" "$@"
