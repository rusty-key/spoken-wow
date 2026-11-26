#!/usr/bin/env bash
#
# Apply a release's pending SQL migrations to the app database.
#
# Usage: migrate.sh /srv/spoken/releases/20260727-2143-a1b2c3d
#
# Called by activate.sh *before* the symlink swap, so a migration that fails leaves the
# previous release serving. Rollback restores code but never un-applies a migration, so
# migrations must stay additive and forward-only: a release must be able to run against the
# schema of the release after it.
set -euo pipefail

TARGET=${1:?usage: migrate.sh <release-dir>}
DIR="$TARGET/migrations"

# A non-interactive `ssh host migrate.sh` gets a minimal PATH.
PSQL=${PSQL:-$(command -v psql || echo /usr/bin/psql)}

# activate.sh sources shared/app.env, but migrate.sh is also worth running by hand.
if [ -z "${DATABASE_URL:-}" ] && [ -f "${SPOKEN_ROOT:-/srv/spoken}/shared/app.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${SPOKEN_ROOT:-/srv/spoken}/shared/app.env"
  set +a
fi
: "${DATABASE_URL:?migrate: DATABASE_URL is unset and shared/app.env did not provide it}"

[ -d "$DIR" ] || { echo "migrate: $TARGET has no migrations/ - bad release?" >&2; exit 1; }

# PGOPTIONS silences the "relation already exists, skipping" notice the bootstrap below
# emits on every deploy after the first.
run() {
  PGOPTIONS='-c client_min_messages=warning' \
    "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"
}

run -c 'create table if not exists schema_migrations (
          name text primary key,
          applied_at timestamptz not null default now())'

# Read once: a psql per migration made every deploy with nothing to apply wait ten seconds.
done_names=$(run -tAc 'select name from schema_migrations')

applied=0
for file in "$DIR"/*.sql; do
  name=$(basename "$file")
  # Recording the name in the same transaction as the DDL is what makes a half-applied
  # migration impossible: psql's --single-transaction rolls back both or commits both.
  if printf '%s\n' "$done_names" | grep -qxF -- "$name"; then
    continue
  fi
  echo "migrate: applying $name"
  run --single-transaction -f "$file" \
    -c "insert into schema_migrations (name) values ('$name')"
  applied=$((applied + 1))
done

echo "migrate: $applied applied, database up to date"
