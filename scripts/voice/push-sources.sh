#!/usr/bin/env bash
# Copy what apps/web/scripts/seed-voice-sources.mts wrote locally onto the droplet: the
# replaced clip directories, their fish.audio references, and the fish_reference rows.
#
#   make web-push-voice-sources ADMIN_EMAIL=you@example.com
#
# Only the voices the seed run replaced, listed in <samples>/.seeded. Their clip directories
# on the droplet are emptied first, because a clone reads every clip in the folder and an
# rsync without --delete would leave the old ones beside the new. Nothing else is touched.
#
# The rows are recorded as ADMIN_EMAIL's on production, looked up there: a local user id
# need not exist on the droplet.
#
# Environment, as make/droplet.mk's DB_ENV passes it: DROPLET, SSH, REMOTE_ROOT, LOCAL_DB.
# LOCAL_DB must be the database the seed run wrote to, apps/web/.env.local's DATABASE_URL,
# which is not necessarily make's default.
set -euo pipefail
. "$(dirname "$0")/../db/lib.sh"

: "${ADMIN_EMAIL:?ADMIN_EMAIL is required: who the rows are recorded as on production}"
: "${LOCAL_DB:?LOCAL_DB is not set}"
RSYNC=${RSYNC:-rsync}

VOICE=pipelines/quests/voice
SAMPLES=$VOICE/samples
REFERENCES=$VOICE/references
LIST=$SAMPLES/.seeded
[ -s "$LIST" ] || { echo "no $LIST: run apps/web/scripts/seed-voice-sources.mts first" >&2; exit 1; }

# A line is a clip directory: `slot` for English, `lang/slot` for another language. Checked
# before any of them reaches `rm -rf` on the droplet.
if grep -vqE '^([a-z]{2}[A-Z]{2}/)?[a-z0-9]+-[a-z0-9]+(-[a-z0-9]+)?$' "$LIST"; then
  echo "unexpected line in $LIST:" >&2
  grep -vE '^([a-z]{2}[A-Z]{2}/)?[a-z0-9]+-[a-z0-9]+(-[a-z0-9]+)?$' "$LIST" >&2
  exit 1
fi

# The same voices as (lang, voice) pairs, for the reference files and the rows.
pairs=$(awk -F/ '{ if (NF == 1) print "enUS " $1; else print $1 " " $2 }' "$LIST")
# Only those that exist: a voice too short for a reference, or whose transcription failed,
# has clips and no reference file.
references=$(awk '{ print $1 "/" $2 ".mp3" }' <<<"$pairs" | while read -r f; do
  if [ -f "$REFERENCES/$f" ]; then echo "$f"; fi; done)
values=$(awk '{ printf "%s(\x27%s\x27, \x27%s\x27)", (NR > 1 ? ", " : ""), $1, $2 }' <<<"$pairs")

# Read before anything on the droplet changes: LOCAL_DB has to be the database the seed run
# wrote to -- apps/web/.env.local's DATABASE_URL -- and a wrong one must stop the push here,
# not after the files are already replaced.
rows=$(psql "$LOCAL_DB" -X -tAc "select count(*) from fish_reference where (lang, voice) in ($values)")
echo "$(wc -l <"$LIST" | tr -d ' ') voices' clips, $(grep -c . <<<"$references" || true) references, $rows rows in $LOCAL_DB"
printf 'Replace these on %s? [y/N] ' "${DROPLET:?no droplet configured}"
read -r answer
[ "$answer" = y ] || { echo aborted; exit 1; }

# shellcheck disable=SC2086 -- SSH carries its own flags
$SSH "$DROPLET" "cd $REMOTE_ROOT/shared/voices && xargs -r rm -rf --" <"$LIST"
$RSYNC -ar --files-from="$LIST" -e "$SSH" "$SAMPLES/" "$DROPLET:$REMOTE_ROOT/shared/voices/"
if [ -n "$references" ]; then
  $RSYNC -a --files-from=<(echo "$references") -e "$SSH" \
    "$REFERENCES/" "$DROPLET:$REMOTE_ROOT/shared/voice-references/"
fi

{
  cat <<SQL
\\set ON_ERROR_STOP on
begin;
create temp table seeded (voice text, lang text, sample text, "startSec" real, "endSec" real,
                          transcript text, "clipHash" text);
copy seeded from stdin;
SQL
  psql "$LOCAL_DB" -X -q -c "\\copy (select voice, lang, sample, \"startSec\", \"endSec\", transcript, \"clipHash\"
                                      from fish_reference where (lang, voice) in ($values)) to stdout"
  cat <<SQL
\\.
insert into fish_reference (voice, lang, sample, "startSec", "endSec", transcript, "clipHash", "updatedBy", "updatedAt",
                            "teamId")
select s.*, (select id from "user" where email = '$ADMIN_EMAIL'), now(),
       (select "teamId" from team_language tl where tl.lang = s.lang and tl.privileged)
  from seeded s
on conflict ("teamId", voice, lang) do update set
  sample = excluded.sample, "startSec" = excluded."startSec", "endSec" = excluded."endSec",
  transcript = excluded.transcript, "clipHash" = excluded."clipHash",
  "updatedBy" = excluded."updatedBy", "updatedAt" = now();
commit;
SQL
} | upstream 'psql "$DATABASE_URL" -X -q -f -'

echo "==> pushed; the site picks the references up within a minute"
