# shellcheck shell=bash
# What scripts/db/sync-section.sh and check-synced.sh share: how to reach production, and
# which table holds each section's corpus. Sourced, not run.
#
# Environment, as the Makefiles pass it (make/droplet.mk's DB_ENV):
#   DROPLET, SSH, REMOTE_ROOT   how to reach production
#   LOCAL_DB                    this machine's database
#   SOURCE_DB                   instead of the droplet, read this database directly --
#                               for rehearsing against a local copy of production

REMOTE_ROOT=${REMOTE_ROOT:-/srv/spoken}

# Whether there is an upstream to read at all.
has_upstream() { [ -n "${SOURCE_DB:-}" ] || [ -n "${DROPLET:-}" ]; }

# Run a command against production's database, with $DATABASE_URL set to it -- or against
# SOURCE_DB when rehearsing. SQL goes on stdin rather than in the command, so its quotes
# never pass through ssh.
upstream() {
  if [ -n "${SOURCE_DB:-}" ]; then
    DATABASE_URL="$SOURCE_DB" bash -c "$1"
  else
    : "${DROPLET:?no droplet configured: export SPOKEN_DROPLET=deploy@<host>}"
    # shellcheck disable=SC2086 -- SSH carries its own flags
    $SSH "$DROPLET" "set -a; . $REMOTE_ROOT/shared/app.env; set +a; $1"
  fi
}

# The table a section's text lives in.
corpus_table() {
  case "$1" in
    quests) echo quest_line ;;
    places) echo lore_line ;;
    readables) echo book_line ;;
    bosses) echo boss_line ;;
    *) echo "unknown section: $1" >&2; return 1 ;;
  esac
}

# pg_dump 16.10 and later wrap output in \restrict / \unrestrict, psql meta-commands an
# older psql fails on. Both clusters are ours, so strip them.
unrestrict() { sed -e '/^\\restrict/d' -e '/^\\unrestrict/d'; }
