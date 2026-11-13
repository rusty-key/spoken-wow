#!/usr/bin/env bash
# Load one language's text into a database: quest lines and names, book pages and titles,
# zone and subzone names.
#
#   scripts/db/import-locale.sh frFR                         # production, through a tunnel
#   scripts/db/import-locale.sh frFR --into postgres://...   # any other database, e.g. to
#                                                            # rehearse on a local copy
#
# Or `make web-import-locale LOCALE=frFR`, which passes the droplet settings.
#
# Runs HERE, not on the droplet: the quests and readables imports read the vmangos MySQL, which
# only a workstation has (make readables-db), and the pipelines are not part of a release. So
# production is reached the other way round -- an ssh tunnel to its Postgres, with the
# credentials read out of the droplet's shared/app.env for the length of this script and
# never written down.
#
# Safe to run again: unchanged text is skipped, and nothing edited on the site is ever
# overwritten (pipelines/lib/promote.mjs). It does not switch the language on; that is
# /admin's Languages panel, once the text looks right.
#
# Environment, as make/droplet.mk's DB_ENV passes it: DROPLET, SSH, REMOTE_ROOT.
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=scripts/db/lib.sh
. scripts/db/lib.sh

LOCALE=${1:-}
[ -n "$LOCALE" ] || { echo "usage: $0 <LOCALE> [--into <database url>]" >&2; exit 2; }
shift
INTO=""
if [ "${1:-}" = "--into" ]; then
  INTO=${2:?--into needs a database url}
fi

# Which of the three sources this language has. `vmangos` is null where the dump carries no
# text at all; place names still come from the addon's aliases. A language no client runs in
# (Italian, Vietnamese) has neither: its text is its community's (make quests-import-questit,
# make quests-import-forever-csv) and what is written on the site.
vmangos=$(node --input-type=module -e '
  const { localeInfo, BASE_LOCALE } = await import("./pipelines/lib/locales.mjs");
  const info = localeInfo(process.argv[1]);
  if (!info || info.code === BASE_LOCALE) { console.error(`not a language to import: ${process.argv[1]}`); process.exit(2); }
  console.log(info.client === false ? "client" : (info.vmangos ?? "none"));
' "$LOCALE")
if [ "$vmangos" = "client" ]; then
  echo "$LOCALE: no game client runs in it, so the game has no text to import."
  echo "Its quest text comes from QuestIT (make quests-import-questit); the rest is written on the site."
  exit 0
fi

# The quests import reads MySQL through pandas and PyMySQL (requirements-extract.txt), which
# the everyday venv does not carry, and the pinned pandas does not build on a new Python. A
# venv made for the extract is used when there is one; either way it is checked here, before
# a tunnel is opened, rather than as a traceback halfway through.
EXTRACT_VENV=pipelines/quests/.venv-extract
if [ -z "${PYTHON:-}" ] && [ -x "$EXTRACT_VENV/bin/python" ]; then
  export PYTHON=$PWD/$EXTRACT_VENV/bin/python
fi
if [ "$vmangos" != "none" ]; then
  "${PYTHON:-pipelines/quests/.venv/bin/python}" -c 'import pandas, pymysql, psycopg2' 2>/dev/null || {
    echo "error: the quests import needs pandas, PyMySQL and psycopg2. Make a venv for it:" >&2
    echo "  uv venv -p 3.11 $EXTRACT_VENV" >&2
    echo "  VIRTUAL_ENV=\$PWD/$EXTRACT_VENV uv pip install -r pipelines/quests/requirements.txt -r pipelines/quests/requirements-extract.txt" >&2
    exit 1
  }
fi

# Column 9 is not vmangos's own: fill_locales_from_tdb.py adds it. Asked before anything else,
# because without it both imports stop at "Unknown column" halfway through.
if [ "$vmangos" = "9" ]; then
  (cd pipelines/quests && "${PYTHON:-.venv/bin/python}" -c '
from tts_cli.sql_queries import make_connection
cur = make_connection().cursor()
cur.execute("select count(*) from information_schema.columns where table_schema = database() and column_name = %s", ("Title_loc9",))
raise SystemExit(0 if cur.fetchone()[0] else 1)') || {
    echo "error: the vmangos dump has no *_loc9 columns for $LOCALE yet. Fill them first:" >&2
    echo "  (cd pipelines/quests && python tools/fill_locales_from_tdb.py --tdb335 ... --tdb-world ... --tdb-hotfixes ...)" >&2
    exit 1
  }
fi

TUNNEL_PORT=${TUNNEL_PORT:-55432}
tunnel=""
cleanup() { [ -z "$tunnel" ] || kill "$tunnel" 2>/dev/null || true; }
trap cleanup EXIT

if [ -n "$INTO" ]; then
  DATABASE_URL=$INTO
  target="${INTO##*@}"
else
  : "${DROPLET:?no droplet configured: export SPOKEN_DROPLET=deploy@<host>}"
  # shellcheck disable=SC2086 -- SSH carries its own flags
  # Neither ssh may read this terminal: the prompt below does. A backgrounded ssh with a
  # terminal on stdin takes keystrokes -- it was eating the "y", and the run stopped at random.
  $SSH -n -N -o ExitOnForwardFailure=yes -L "$TUNNEL_PORT:127.0.0.1:5432" "$DROPLET" &
  tunnel=$!
  for _ in $(seq 1 50); do
    nc -z 127.0.0.1 "$TUNNEL_PORT" 2>/dev/null && break
    kill -0 "$tunnel" 2>/dev/null || { echo "error: the tunnel did not come up" >&2; exit 1; }
    sleep 0.2
  done
  remote=$(upstream 'printf %s "$DATABASE_URL"' </dev/null)
  # The droplet's own address for its database, re-aimed at this end of the tunnel.
  DATABASE_URL=$(printf %s "$remote" | sed -E "s#@[^/]+/#@127.0.0.1:$TUNNEL_PORT/#")
  target="production ($DROPLET)"
fi
export DATABASE_URL

# The schema has to be the one these imports write: entity_name arrived in 0036.
psql "$DATABASE_URL" -Atqc 'select 1 from "entity_name" limit 1' >/dev/null || {
  echo "error: $target has no entity_name table -- deploy (or migrate) first" >&2
  exit 1
}

echo "Importing $LOCALE into $target."
if [ -t 0 ]; then
  read -r -p "Go on? [y/N] " answer
  [ "$answer" = "y" ] || { echo "stopped"; exit 1; }
fi

if [ "$vmangos" = "none" ]; then
  echo "== quests, readables: skipped -- the vmangos dump has no $LOCALE text"
else
  echo "== quests"
  make --no-print-directory quests-import-locale LOCALE="$LOCALE"
  echo "== readables"
  make --no-print-directory readables-import-locale LOCALE="$LOCALE"
fi
echo "== zone and subzone names"
make --no-print-directory places-lore-import-names LOCALE="$LOCALE"

echo
echo "Done. Nothing is public yet: check /$LOCALE/quests as an admin, then switch $LOCALE on"
echo "in /admin (Languages)."
