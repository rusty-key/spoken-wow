#!/usr/bin/env bash
# Fetch the archived takes a section's pack is built from, and no others.
#
#   scripts/audio/pull-live.sh <quests|places|readables>
#   scripts/audio/pull-live.sh <section> <lang>   another language's pack
#   scripts/audio/pull-live.sh <section> <lang> recorded
#                                                 the voice actors' live recordings instead,
#                                                 which the acted overlay is built from
#
# The list is the local database's live takes, written by `sounds.mjs --list` -- the same
# query that later copies them into the pack -- so run the section's sync first: a pull
# against a stale database fetches the takes production has already replaced. The full
# archive, every take ever cut, is still `make <section>-pull-history`, for listening to
# old takes; a build does not need it.
#
# rsync --files-from rather than a loop: one connection, and files already here are
# skipped by size and mtime like any other rsync. Never --delete: takes that stop being
# live stay on disk, and the archive only ever grows.
#
# A live take production has no file for fails the pull (rsync exits 23), because that
# pack would ship silence for the line. A take with a hash is fetched from the bucket
# instead, by fetch-blobs.mjs, when SPOKEN_ARCHIVE_URL says where it is.
#
# Environment, as the Makefiles pass it (make/droplet.mk's DB_ENV, plus RSYNC):
#   DROPLET, SSH, REMOTE_ROOT   how to reach production
#   LOCAL_DB                    the database whose live takes are listed
#   RSYNC                       an rsync 3.x; macOS's openrsync lacks --info
#   SPOKEN_ARCHIVE_URL          the archive bucket's public address, when it has the clips
set -euo pipefail

section=${1:?usage: pull-live.sh <quests|places|readables> [lang]}
# A language's takes live under <lang>/ in the same archive, and the list sounds.mjs prints
# already carries that prefix, so the rsync below is the same for every language and lands
# them beside English's rather than over them.
lang=${2:-enUS}
REMOTE_ROOT=${REMOTE_ROOT:-/srv/spoken}

root="$(cd "$(dirname "$0")/../.." && pwd)"
# The recordings sit in the same archive, under recorded/<lang>/, and acted.mjs prints them
# relative to its root the same way, so only the lister changes.
what=${3:-takes}
case "$what" in
  takes) lister="$root/scripts/audio/sounds.mjs"; next="make $section-sounds";;
  recorded) lister="$root/scripts/audio/acted.mjs"; next="make $section-package-acted";;
  *) echo "usage: pull-live.sh <section> [lang] [recorded]" >&2; exit 2;;
esac
# Where sounds.mjs reads the archive from, including its SPOKEN_<SECTION>_AUDIO_HISTORY
# override, so the pull lands where the build looks.
override="SPOKEN_$(printf '%s' "$section" | tr '[:lower:]' '[:upper:]')_AUDIO_HISTORY"
archive=${!override:-$root/pipelines/$section/audio-history}

list=$(mktemp)
files=$(mktemp)
trap 'rm -f "$list" "$files"' EXIT
node "$lister" --list --lang="$lang" "$section" >"$list"
echo "==> $(wc -l <"$list" | tr -d ' ') live $section $lang $what"

mkdir -p "$archive"
# Rows with a hash come from the public bucket when SPOKEN_ARCHIVE_URL is set (the lister
# then prints blobs/<prefix>/<sha256> for them); only the rest still need the droplet.
if [ -n "${SPOKEN_ARCHIVE_URL:-}" ]; then
  node "$root/scripts/audio/fetch-blobs.mjs" "$archive" <"$list"
  # And the Ogg the site encoded each quests take to at commit, into package-audio.sh's cache.
  if [ "$section" = quests ] && [ "$what" = takes ]; then
    node "$root/scripts/audio/fetch-encodings.mjs" --lang="$lang"
  fi
fi
grep -v '^blobs/' "$list" >"$files" || true
if [ ! -s "$files" ]; then
  suffix=""
  [ "$lang" = enUS ] || suffix=" LOCALE=$lang"
  echo "==> every clip is in ${archive#"$root"/}. Next:  $next$suffix"
  exit 0
fi
: "${DROPLET:?no droplet configured: export SPOKEN_DROPLET=deploy@<host>}"
: "${RSYNC:?no rsync 3.x found. macOS ships openrsync, which lacks --info: brew install rsync}"
# shellcheck disable=SC2086 -- SSH carries its own flags
"$RSYNC" -a --partial --human-readable --info=stats1,progress2 -e "$SSH" \
  --files-from="$files" "$DROPLET:$REMOTE_ROOT/shared/audio-history/$section/" "$archive/" || {
  status=$?
  if [ "$status" = 23 ]; then
    echo "Some live takes are not in production's archive. If this database has not been" >&2
    echo "synced lately, those rows are ones production has moved past: make $section-sync" >&2
  fi
  exit "$status"
}
suffix=""
[ "$lang" = enUS ] || suffix=" LOCALE=$lang"
echo "==> pulled into ${archive#"$root"/}. Next:  $next$suffix"
