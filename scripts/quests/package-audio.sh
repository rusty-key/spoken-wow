#!/usr/bin/env bash
# Build the data module from transcoded copies of the audio store, and zip it.
#
#   make package-audio                 # the four shipping packs, Ogg Vorbis, into dist/

#   make package-audio VERSION=1.4.0   # the version written into the .toc
#   ENCODE=copy make package-audio     # the masters, untranscoded, for a listening check
#   JOBS=1 make package-audio          # serial, when a failing encode needs readable output
#
# The store is 3.2 GB of mono speech, almost all of it 128 kbps CBR from ElevenLabs;
# 48 files are still the 64 kbps pack this project inherited. Shipping that as-is
# asks a player to download three gigabytes for audio most of them hear once per
# quest. docs/quests/docs/pack-size.md measures every encode that was considered.
#
# THE SHIPPING PACK IS OGG VORBIS AT 44.1 kHz (`ogg-q0-44k`), which make passes in:
# 3.2 GB of masters become ~1.3 GB, split five ways. Vorbis is worth 1.3-1.5x over
# LAME at these rates, and it is VBR, so the bits follow the voice instead of padding
# silence to a constant rate.
#
# A 22.05 kHz downsample halves that again and speech survives an 11 kHz ceiling, so
# it shipped as a second family for a while. It is retired - one family is one set of
# projects, one set of folder names and one answer to "which do I install" - and the
# profile stays available here for anyone measuring. docs/quests/docs/pack-size.md has the numbers.
#
# The masters stay in audio/ untouched, so raising the shipped quality later is a
# re-run of this script rather than a second purchase from ElevenLabs, which bills
# characters and not bytes.
#
# A pack ships ONE format, because the module resolves every sound through a single
# GetSoundPath. So for an ogg profile every clip is encoded; the bitrate threshold
# below only decides anything when the target is mp3 and the clip is already mp3,
# where a second lossy pass over a 64 kbps file would be no smaller and audibly
# worse. See tools/plan_transcode.py.
#
# Separate from `python cli-main.py build`, which copies the store as it finds it.
# That command is still what assembles the module - this stages a transcoded store
# and hands it over, so there is one definition of what a module contains.
#
# Durations come out right without doing anything: build computes
# sound_length_table.lua from the files it just copied, and mutagen reads a VBR
# mp3's Xing header and an Ogg page's granule position alike. A table built from
# the masters and shipped beside transcodes would drift, which is the failure this
# ordering avoids.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

# The Python half of this project lives under pipelines/quests/, and both of its entry points
# resolve their own defaults -- the corpus, the ignore list, the factions export -- relative to
# that directory. So the paths here are absolute and the two commands below are run from there,
# rather than every default being restated as a flag that would go stale one at a time.
QUESTS="$REPO/pipelines/quests"

STORE="${STORE:-$QUESTS/audio}"
DIST="${DIST:-$REPO/dist}"
# The shipping packs' folder prefix, which every pack suffix is appended to. Renaming it renames
# the folder players install, which is safe here only because nothing stores a path built from
# it - DataModules composes one at play time from the folder the client reports - and costs a
# re-download the next release was going to cost anyway. It was VoiceOverReduxHQAudio until the
# projects were renamed; DataModules:availableModules has to be kept in step with it, since that
# is how the player recognises an installed pack.
MODULE="${MODULE:-SpokenQuestsAudio}"
VERSION="${VERSION:-2.0.0}"
# Which packs to build; each becomes MODULE plus the suffix tts_cli/factions.py gives it.
#
# The four that ship. 'all' - one folder holding every line - is not among them: CurseForge
# cannot take it (577 MB is a Cloudflare 413) and ships the meta addon from
# scripts/package-meta.sh under that project instead, and GitHub gets the four folders bundled
# into one zip (below), so a player who moves between the two overwrites the same folders. Build
# it with PACKS=all when you want the whole thing in one folder locally, which is also the fast
# way to try an encode change.
PACKS="${PACKS:-alliance horde shared gossip}"
ENCODE="${ENCODE:-ogg-q0-44k}"
ZIP="${ZIP:-1}"
# Distinguishes the zips of two profiles built from the same module name, so one profile's
# build does not overwrite another's in dist/.
LABEL="${LABEL:-}"
# Names the addon folder outright, instead of MODULE plus the pack's suffix. Only meaningful
# when building a single pack, and it exists for the complete build: one folder holding every
# line, which is a thing of its own rather than a bigger copy of the All pack.
MODULE_NAME="${MODULE_NAME:-}"
TITLE="${TITLE:-}"
# The family a build belongs to: MODULE is the folder every pack's suffix is appended to, and
# TITLE_FAMILY the words before the colon in every title. Both are parameters because a set of
# packs built together is named together - a second encode once, a language pack next - and a
# set needs a folder and projects of its own rather than a variant spelled onto the end of each
# name, since two packs under one project would have an addon manager updating a player from
# the one they chose into the other.
TITLE_FAMILY="${TITLE_FAMILY:-}"
# kbps above which an mp3 is worth re-encoding as an mp3. See tools/plan_transcode.py.
THRESHOLD="${THRESHOLD:-80}"

# The language being packaged. English builds exactly as it always has; another language
# builds each of its registered packs (scripts/lib/packs.mjs) from its assembled store in
# build/quests/<lang>/audio, named, titled and versioned by its page.
LANGUAGE="${LANGUAGE:-enUS}"
if [ "$LANGUAGE" != enUS ]; then
  STORE="$REPO/build/quests/$LANGUAGE/audio"
  PACKS="$(node "$REPO/scripts/lib/packs.mjs" list quests "$LANGUAGE" | tr '\n' ' ')"
fi
# A language's Gossip pack - or its All pack, when it ships as one - also carries that language's
# gossip text, so a client in it matches the NPC's words (tts_cli/locale_text.py). make writes
# the file first (export-locale-text).
# A language no client runs in has none: no client shows its words to match.
LOCALE_TEXT="$REPO/build/quests/$LANGUAGE/locale-text.json.gz"
CLIENT_LANGUAGE="$(node --input-type=module -e 'const { isClientLocale } = await import(process.argv[1]); console.log(isClientLocale(process.argv[2]) ? "yes" : "no")' "$REPO/pipelines/lib/locales.mjs" "$LANGUAGE")"
if [ "$CLIENT_LANGUAGE" = no ]; then
  LOCALE_TEXT=""
fi
if [ "$LANGUAGE" != enUS ] && [ -n "$LOCALE_TEXT" ] && [[ " $PACKS " == *" gossip "* || " $PACKS " == *" all "* ]] \
    && [ ! -f "$LOCALE_TEXT" ]; then
  echo "error: no $LANGUAGE gossip text at $LOCALE_TEXT -- run: make quests-export-locale-text LOCALE=$LANGUAGE" >&2
  exit 1
fi
pack_field() { node "$REPO/scripts/lib/packs.mjs" get quests "$LANGUAGE" "$1" "$2"; }

# Transcoded clips, kept between runs. A sibling of dist/ and of the store, for the
# reason web/src/lib/paths.ts gives about audio-history: anything living under
# audio/ would be walked as if it were a voiceline.
#
# CONTENT-ADDRESSED, so a cache hit cannot be stale: the entry is named for the
# md5 of the master it came from, and a regenerated line hashes differently and
# misses. Keying on mtime would be cheaper and wrong - audio/ is assembled afresh
# from the archive before every build, so an mtime says when it was assembled, not
# what the clip holds.
CACHE_ROOT="${CACHE_ROOT:-$QUESTS/audio-transcoded}"

PYTHON="${PYTHON:-$([ -x "$QUESTS/.venv/bin/python" ] && echo "$QUESTS/.venv/bin/python" || command -v python3)}"
# tts_cli is a package in the pipeline directory rather than something installed into the venv,
# and Python puts the *script's* directory on sys.path, not the working one - so `python -c` and
# `python tools/x.py` both miss it however this script is invoked.
export PYTHONPATH="$QUESTS${PYTHONPATH:+:$PYTHONPATH}"
JOBS="${JOBS:-$( (command -v nproc >/dev/null 2>&1 && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"

# Each profile is a format, the flags that produce it, and nothing else. FORMAT is what the
# module ends up shipping and what the plan is asked for; OGG_FLAGS is empty for the mp3
# profiles and unused there.
OGG_FLAGS=""
case "$ENCODE" in
  ogg-q-1-22k) FORMAT=ogg; OGG_FLAGS="-q -1 --resample 22050";;
  ogg-q0-44k)  FORMAT=ogg; OGG_FLAGS="-q 0";;
  vbr-v6)      FORMAT=mp3;;
  copy)        FORMAT=mp3;;
  *) echo "error: unknown ENCODE '$ENCODE' (expected: ogg-q-1-22k, ogg-q0-44k, vbr-v6, copy)" >&2
     exit 1;;
esac

[ -d "$STORE" ] || { echo "error: no audio store at $STORE" >&2; exit 1; }
if [ "$ENCODE" != copy ] && ! command -v ffmpeg >/dev/null 2>&1; then
  echo "error: ffmpeg is not on PATH. brew install ffmpeg, or run with ENCODE=copy" >&2
  exit 1
fi
# Homebrew's ffmpeg is built without libvorbis, and ffmpeg's own vorbis encoder is
# experimental and worse than libvorbis at every rate. So oggenc encodes and ffmpeg only
# decodes, which also keeps the flags here the ones every Vorbis comparison is written in.
if [ "$FORMAT" = ogg ] && ! command -v oggenc >/dev/null 2>&1; then
  echo "error: oggenc is not on PATH. brew install vorbis-tools" >&2
  exit 1
fi

# --- the plan ---------------------------------------------------------------------------
#
# tools/plan_transcode.py decides what happens to each clip and why; see its header. It is
# told the target format because that is half the decision: everything becomes an ogg, while
# an mp3 target spares whatever is already at or below the threshold. Ignored lines are
# dropped there too, before the expensive stage sees them.
plan="$(mktemp)"
staging="$(mktemp -d)"
trap 'rm -f "$plan"; rm -rf "$staging"' EXIT

echo "planning..."
(cd "$QUESTS" && "$PYTHON" tools/plan_transcode.py --store "$STORE" --format "$FORMAT" \
  --threshold "$THRESHOLD") > "$plan"
count="$(wc -l <"$plan" | tr -d ' ')"

# Directories first in one pass, so placing the clips below is a flat run of cp rather
# than thousands of mkdir processes.
rsync -a -f'+ */' -f'- *' "$STORE/" "$staging/"

if [ "$ENCODE" = copy ]; then
  echo "copying $count masters (ENCODE=copy)..."
  cut -f4 "$plan" | while IFS= read -r rel; do cp "$STORE/$rel" "$staging/$rel"; done
else
  if [ "$LANGUAGE" = enUS ]; then cache="$CACHE_ROOT/$ENCODE"; else cache="$CACHE_ROOT/$LANGUAGE-$ENCODE"; fi
  mkdir -p "$cache"

  # Deduplicated: two identical masters share a key, and two workers must not write one
  # cache entry between them.
  todo="$(mktemp)"
  awk -F'\t' '$3 == "encode" {print $1 "\t" $4}' "$plan" | sort -u -k1,1 \
    | while IFS=$'\t' read -r key rel; do
        [ -f "$cache/$key.$FORMAT" ] || printf '%s\t%s\n' "$key" "$STORE/$rel"
      done > "$todo"

  wanted="$(awk -F'\t' '$3 == "encode"' "$plan" | wc -l | tr -d ' ')"
  encoded="$(wc -l <"$todo" | tr -d ' ')"
  hits=$((wanted - encoded))

  if [ "$encoded" -gt 0 ]; then
    # Minutes of ffmpeg with nothing on stdout is indistinguishable from a hang. The
    # count comes from a file rather than a variable: each worker is its own process, so
    # an incremented shell variable would die with it.
    progress="$(mktemp)"
    export CACHE="$cache" PROGRESS="$progress" TOTAL="$encoded" \
           FORMAT="$FORMAT" OGG_FLAGS="$OGG_FLAGS"
    encode_one() {
      # Via .part and mv, so an interrupted run cannot leave a truncated file under a
      # name claiming to be a complete encode of that checksum. The pid is in there too,
      # so two copies of this script cannot land in each other's scratch file. -f mp3 is
      # required with it: ffmpeg picks the muxer from the extension, and ".part" is not
      # one it knows.
      local part="$CACHE/$2.$$.part"
      if [ "$FORMAT" = ogg ]; then
        # Unquoted on purpose: OGG_FLAGS is several arguments, set by this script and
        # nothing else.
        ffmpeg -nostdin -loglevel error -f mp3 -i "$1" -ac 1 -f wav - \
          | oggenc -Q $OGG_FLAGS -o "$part" -
      else
        ffmpeg -nostdin -loglevel error -f mp3 -i "$1" \
          -codec:a libmp3lame -q:a 6 -ac 1 -f mp3 "$part"
      fi
      mv "$part" "$CACHE/$2.$FORMAT"

      # One byte per finished file; short appends to O_APPEND do not interleave, so the
      # size is the count.
      printf '.' >>"$PROGRESS"
      local n; n="$(wc -c <"$PROGRESS" | tr -d ' ')"
      if [ -t 1 ]; then printf '\r  %5d/%-5d encoded' "$n" "$TOTAL"
      elif [ $((n % 250)) -eq 0 ] || [ "$n" -eq "$TOTAL" ]; then echo "  $n/$TOTAL encoded"; fi
    }
    export -f encode_one

    echo "encoding $encoded files ($ENCODE, mono) across $JOBS jobs (cache: $cache)"
    echo "  $hits of $wanted already cached"
    tr '\t\n' '\0\0' <"$todo" | xargs -0 -P "$JOBS" -n 2 bash -c 'encode_one "$1" "$0"'
    [ -t 1 ] && printf '\n'
    rm -f "$progress"
  else
    echo "all $wanted encodable files already cached ($ENCODE, $cache)"
  fi

  # Placement, and the one judgement left to make here: for an mp3 pack, an encode that came
  # out no smaller than its master is a second lossy pass for nothing, so the master wins.
  # plan_transcode keeps that rare by reading bitrates, but bitrate is an average and some
  # clips will still land the wrong way round.
  #
  # For an ogg pack that judgement is not available: a module ships one format, so falling
  # back to the master would strand that line on a path GetSoundPath does not write. A clip
  # that encodes larger than its master ships larger.
  kept=0
  while IFS=$'\t' read -r key kbps action rel; do
    if [ "$action" != encode ]; then
      cp "$STORE/$rel" "$staging/$rel"
    elif [ "$FORMAT" != mp3 ] \
         || [ "$(wc -c <"$cache/$key.$FORMAT")" -lt "$(wc -c <"$STORE/$rel")" ]; then
      cp "$cache/$key.$FORMAT" "$staging/${rel%.mp3}.$FORMAT"
    else
      kept=$((kept + 1))
      cp "$STORE/$rel" "$staging/$rel"
    fi
  done <"$plan"

  # Entries for masters since re-cut or deleted. Without this the cache keeps every
  # superseded encode forever, which is what audio-history/ is for and this is not.
  # sed rather than -exec basename: a process per cached file took minutes on macOS.
  pruned=0
  while IFS= read -r stale; do
    [ -n "$stale" ] || continue
    rm -f "$cache/$stale"
    pruned=$((pruned + 1))
  done < <(comm -23 \
    <(find "$cache" -name "*.$FORMAT" | sed 's#.*/##' | sort) \
    <(awk -F'\t' -v ext=".$FORMAT" '$3 == "encode" {print $1 ext}' "$plan" | sort -u) || true)

  echo "  $hits reused, $encoded encoded, $kept masters kept as smaller, $pruned superseded entries dropped"
  rm -f "$todo"
fi

# --- the modules -----------------------------------------------------------------------
#
# ONE STAGED STORE, SEVERAL PACKS. 600 MB is more than CurseForge takes in one upload and more
# than a player wants for lines their character cannot reach, so the store is transcoded once
# and built into a pack per side of the war, one for the quests both sides share, one for
# gossip. Each is an addon folder of its own - a second file on
# one project would let an addon manager move a player from the pack they chose to whichever
# was uploaded last. tts_cli/factions.py holds the split and explains it.
#
# --store, so this is the same build everyone runs, over a store whose clips happen to be
# smaller. The lookup tables, the TOC and the length table are all built by that command and
# are not this script's business.
for pack in $PACKS; do
  title="$TITLE"
  if [ -n "$MODULE_NAME" ]; then
    module="$MODULE_NAME"
  else
    suffix="$("$PYTHON" -c "from tts_cli.factions import PACK_SUFFIXES; print(PACK_SUFFIXES['$pack'])")"
    module="$MODULE$suffix"
    if [ -n "$TITLE_FAMILY" ]; then
      title="$(TITLE_FAMILY="$TITLE_FAMILY" "$PYTHON" -c \
        "import os; from tts_cli.factions import pack_title; print(pack_title('$pack', os.environ['TITLE_FAMILY']))")"
    fi
  fi

  version="$VERSION"
  language_args=()
  build_pack="$pack"
  if [ "$LANGUAGE" != enUS ]; then
    module="$(pack_field "$pack" folder)"
    # A Shared page that holds every quest builds the quests slice (scripts/lib/packs.mjs).
    build_pack="$(pack_field "$pack" build)"
    title="$(pack_field "$pack" name)"
    version="$(pack_field "$pack" version)"
    language_args=(--language "$LANGUAGE")
    if [ -n "$LOCALE_TEXT" ] && { [ "$pack" = gossip ] || [ "$pack" = all ]; }; then language_args+=(--locale-text "$LOCALE_TEXT"); fi
  fi

  echo
  echo "building $module ($pack)"
  # ${language_args[@]+...} rather than a bare expansion: macOS's bash 3.2 raises "unbound
  # variable" under set -u when a plain "${arr[@]}" is empty, which it is on every English build.
  (cd "$QUESTS" && "$PYTHON" cli-main.py build --store "$staging" --dist "$DIST" \
    --module "$module" --version "$version" --pack "$build_pack" ${title:+--module-title "$title"} \
    "${language_args[@]+"${language_args[@]}"}")

  # The word times of the English recordings this pack holds, when WORD_TIMES names the
  # word-times.json that pipelines/timings/export.py wrote. A language's recordings are not
  # the ones they were measured on.
  if [ -n "${WORD_TIMES:-}" ] && [ "$LANGUAGE" = enUS ]; then
    "$PYTHON" "$REPO/pipelines/timings/pack_times.py" --times "$WORD_TIMES" "$DIST/$module"
  fi

  echo "  module size: $(du -sh "$DIST/$module" | cut -f1)  (store: $(du -sh "$STORE" | cut -f1))"

  [ "$ZIP" = 1 ] || continue

  # Absolute before the subshell cds into DIST, and derived from DIST itself so an absolute
  # DIST (a scratch directory in a test run) is not glued onto the repo root.
  #
  # LABEL is what keeps the encode profiles apart, since both build the same folder names -
  # they are alternatives and a player installs one, so only the zip carries it.
  zip_path="$(cd "$DIST" && pwd)/$module$LABEL-$version.zip"
  rm -f "$zip_path"
  echo "  zipping $(basename "$zip_path")..."
  (cd "$DIST" && zip -r -q -X "$zip_path" "$module" -x '*.DS_Store' '*.part')
  # The folder was built before its zip; scripts/manager/publish.mjs refuses a folder older than
  # its zip as a stale build, so mark this one as current.
  touch "$DIST/$module/$module.toc"
  echo "  ==> $zip_path ($(du -h "$zip_path" | cut -f1))"
done

# THE GITHUB BUNDLE. English quests go to GitHub as one download, but one holding the four split
# packs' own folders rather than a fifth folder with every line: the same folders CurseForge
# installs, so a player who takes one channel and then the other overwrites them instead of
# installing every line twice. Made from the folders this run just built, so it is only made
# when the run built all four; scripts/lib/packs.mjs names the zip and the folders in it.
if [ "$ZIP" = 1 ] && [ "$LANGUAGE" = enUS ] && [ -z "$MODULE_NAME" ] && [ -z "$LABEL" ]; then
  bundled="$(node "$REPO/scripts/lib/packs.mjs" get quests enUS all bundles)"
  built=1
  for pack in alliance horde shared gossip; do [[ " $PACKS " == *" $pack "* ]] || built=0; done
  if [ "$built" = 1 ] && [ "$MODULE" = SpokenQuestsAudio ]; then
    bundle_path="$(cd "$DIST" && pwd)/$(node "$REPO/scripts/lib/packs.mjs" get quests enUS all folder)-$VERSION.zip"
    rm -f "$bundle_path"
    echo
    echo "bundling $bundled into $(basename "$bundle_path")..."
    # shellcheck disable=SC2086 -- bundled is a list of folder names
    (cd "$DIST" && zip -r -q -X "$bundle_path" $bundled -x '*.DS_Store' '*.part')
    echo "  ==> $bundle_path ($(du -h "$bundle_path" | cut -f1))"
  fi
fi
