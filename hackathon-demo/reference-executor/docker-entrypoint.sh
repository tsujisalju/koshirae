#!/bin/sh
set -e

# node_modules is an anonymous volume (see docker-compose.yml), so it
# persists across `docker compose up`/`restart` independent of the
# bind-mounted source — switching branches changes package-lock.json but
# never touches that volume. We keep our own checksum marker rather than
# comparing against npm's internal node_modules/.package-lock.json: that
# file is NOT a byte-for-byte copy of the real lockfile (it omits the root
# package's own metadata block and every other-platform optional
# dependency), so a naive `cmp` against it is always "different" and
# triggers a needless full reinstall on every single container start.
LOCKFILE_HASH_FILE="node_modules/.lockfile-hash"
CURRENT_HASH=$(sha256sum package-lock.json | awk '{print $1}')

if [ ! -f "$LOCKFILE_HASH_FILE" ] || [ "$(cat "$LOCKFILE_HASH_FILE")" != "$CURRENT_HASH" ]; then
  echo "docker-entrypoint: package-lock.json changed, running npm ci..."
  npm ci
  echo "$CURRENT_HASH" > "$LOCKFILE_HASH_FILE"
fi

exec "$@"
