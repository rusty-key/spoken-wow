#!/usr/bin/env bash
# Builds the Places sound pack.
#
#   ./scripts/package-audio.sh                 # the pack
#   ./scripts/package-audio.sh standard        # just the 64kbps one
#   ./scripts/package-audio.sh high            # just the 128kbps one
#   LOCALE=esMX ./scripts/package-audio.sh     # another language's pack
#
# A language other than English is built from build/places/<lang> -- staged there by
# `make places-sounds LOCALE=..` and `make places-lookup LOCALE=..` -- into a folder named and
# versioned by its store page (scripts/lib/packs.mjs), at the one VBR tier every language ships.
#
# Two tiers exist because this is a ~790MB download at the source bitrate, which
# is a lot to ask for narration that is mostly listened to once per zone. The
# standard tier is VBR mono (lame -V6, ~50kbps effective on speech): close to
# transparent for narration, and VBR spends the bits where the voice needs them
# instead of padding silence to a constant rate. The pack keeps "64" in its name
# and .toc as the nominal tier label.
#
# Separate from package.sh because the two addons are released on their own
# cadences: most ZoneLore releases do not touch a single voiceline, and the audio
# should not ride along with a Lua bugfix.
#
# ElevenLabs bills characters, not bytes, so the audio is generated at the highest
# quality the plan allows and shrunk here instead. That keeps a high-quality master
# on disk: raising a shipped bitrate later is a re-run of this script rather than
# a second purchase.
#
# Each tier ships as its own addon folder so a player can install both and switch
# between them in-game. They share one generated Data/Sounds.lua, which reads its
# own folder name and tier out of the .toc at load time -- see build-lookup.mjs.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The Node steps below read the manifest from Postgres when DATABASE_URL is set, and the
# repo-root .env sets it -- so packaging on a laptop whose Postgres is not running failed
# with ECONNREFUSED from a step called "checking the lookup table against the files".
#
# Defined-but-empty is what env.mjs reads as "use the committed files": an already-set variable
# wins over .env. ${DATABASE_URL-} keeps an explicit setting, including one make passed in, and
# supplies the empty default when there is none.
export DATABASE_URL="${DATABASE_URL-}"

# A missing .toc reads as no version, which every caller refuses with its own remedy.
toc_version() { { sed -n 's/^## Version:[[:space:]]*//p' "$@" 2>/dev/null || true; } | head -1 | tr -d '\r'; }

# The language being packaged. Everything below that names a folder, a title or a cache follows
# from it, so an esMX run cannot write into English's folder or its zip.
LOCALE="${LOCALE:-enUS}"
if [[ ! "$LOCALE" =~ ^[a-z]{2}[A-Z]{2}$ ]]; then
  echo "error: LOCALE=$LOCALE is not a language code (e.g. esMX)" >&2
  exit 1
fi
english() { [[ "$LOCALE" == "enUS" ]]; }

# The source is always English's folder: the .toc, README and everything but the audio and
# the lookup come from it regardless of language.
SRC="$REPO/addons/SpokenPlacesAudio"
TOC="$SRC/SpokenPlacesAudio.toc"
DIST="$REPO/dist"

if english; then
  SOUNDS="$SRC/Sounds"
  LOOKUP="$SRC/Data/Sounds.lua"
else
  # Staged by `make places-sounds LOCALE=..` and `make places-lookup LOCALE=..`: build output,
  # never committed. What this language's pack is called comes from its page.
  WORK="$REPO/build/places/$LOCALE"
  SOUNDS="$WORK/Sounds"
  LOOKUP="$WORK/Data/Sounds.lua"
  pack_field() { node "$REPO/scripts/lib/packs.mjs" get places "$LOCALE" - "$1"; }
  PACK_FOLDER="$(pack_field folder)"
  PACK_TITLE="$(pack_field name)"
  PACK_VERSION="$(pack_field version)"
  PACK_SLUG="$(pack_field slug)"
fi

# Transcoded clips, kept between runs. A sibling of dist/ rather than a child,
# because `make clean` removes dist/ and re-encoding the corpus is five minutes.
#
# CONTENT-ADDRESSED: the file name is the checksum of the master it came from, so
# a cache hit cannot be stale -- a re-cut voiceline hashes differently and misses.
# Keying on mtime would be cheaper and wrong: Sounds/ is assembled afresh from the
# archive before every build, so an mtime says when it was assembled, not what the
# clip holds. Checksumming all 1353 masters costs ~2s against ~5min of ffmpeg.
CACHE_ROOT="$REPO/pipelines/places/audio-transcoded"

checksum() {
  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$1" | cut -d' ' -f1
  else
    md5 -q "$1"
  fi
}
export -f checksum

# libmp3lame is single-threaded, so the corpus encodes as fast as there are cores
# to put ffmpeg processes on. Override with JOBS=1 to get the old serial order
# back when a failing encode needs readable output.
JOBS="${JOBS:-$( (command -v nproc >/dev/null 2>&1 && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"

# tier -> folder name, bitrate, title. The source tree is already the high tier,
# so that one is copied rather than transcoded, and it keeps the unqualified name:
# the full-quality pack is the one a player should land on without having to
# choose, and the smaller one advertises the trade in its own name.
#
# tier_encoding names the ffmpeg recipe AND the cache directory, so changing the
# recipe automatically starts a fresh cache instead of serving entries cut with
# the old one. "copy" means no transcode.
tier_folder() {
  if ! english; then echo "$PACK_FOLDER"; return; fi
  case "$1" in standard) echo "ZoneLoreAudio64";; high) echo "SpokenPlacesAudio";; esac
}
tier_bitrate()  { case "$1" in standard) echo "64";; high) echo "128";; esac; }
tier_encoding() { case "$1" in standard) echo "vbr-v6";; high) echo "copy";; esac; }
# The high tier was renamed from ZoneLoreAudio with the projects: a pack reads its own folder
# name out of the loader, so nothing breaks, and the re-download it costs is one the release
# doing the rename costs anyway. ZoneLoreAudio64 keeps its name because it is retired.
# Another language's title is its page's.
tier_title() {
  if ! english; then echo "$PACK_TITLE"; return; fi
  case "$1" in standard) echo "Spoken Audio: Places 64";; high) echo "Spoken Audio: Places";; esac
}

# One tier, now that the 64 kbps pack is retired: two qualities meant two CurseForge
# projects, two folder names and a question at install time that the answer "take the
# bigger one" always won. ZoneLoreAudio64 stays published so existing installs keep
# working and is never uploaded to again. `standard` is still reachable by naming it.
# A language's tier is `high`, encoding `copy`: its clips arrive already at the bitrate
# they ship at, so there is nothing to transcode.
tiers=("high")

# A language ships one tier, `high`, at the bitrate its clips already arrive at -- there is no
# standard/VBR variant to build for it, and letting a tier argument through would quietly build
# one at VBR and prune English's vbr-v6 cache of masters this run never touched.
if [[ $# -gt 0 ]] && ! english; then
  echo "error: LOCALE=$LOCALE ships one tier (high) -- pass no tier argument for a language" >&2
  exit 1
fi

if [[ $# -gt 0 ]]; then
  for arg in "$@"; do
    if [[ -z "$(tier_bitrate "$arg")" ]]; then
      echo "error: unknown tier '$arg' (expected: standard, high)" >&2
      exit 1
    fi
  done
  tiers=("$@")
fi

if [[ ! -f "$TOC" ]]; then
  echo "error: $TOC not found" >&2
  exit 1
fi

if english; then
  version="$(toc_version "$TOC")"
else
  version="$PACK_VERSION"
fi
if [[ -z "$version" ]]; then
  echo "error: no '## Version:' line in $TOC" >&2
  exit 1
fi

# The language is set by rewriting this line, so a .toc without it would ship a
# pack that reports itself as English and plays under English text only.
if ! grep -q '^## X-SpokenPlaces-Language:' "$TOC"; then
  echo "error: $TOC has no '## X-SpokenPlaces-Language:' line to rewrite" >&2
  exit 1
fi

count="$(find "$SOUNDS" -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ' || true)"
if [[ "$count" -eq 0 ]]; then
  echo "error: no mp3 files in $SOUNDS" >&2
  if english; then
    echo "       Generate some first, on the site, then:  make places-pull-live places-sounds" >&2
  else
    echo "       Generate some first, on the site, then:  make places-pull-live places-sounds places-lookup LOCALE=$LOCALE" >&2
  fi
  exit 1
fi

# A lookup table that does not match the files on disk is the failure that plays
# silence in-game rather than erroring, so check it here rather than discovering
# it after upload.
echo "checking the lookup table against the files..."
SPOKEN_PLACES_LANG="$LOCALE" node "$REPO/pipelines/places/tools/voice/validate-audio.mjs"

# Each tier ships the README for its own CurseForge page, so the description a
# player read before downloading is the file they end up with.
node "$REPO/scripts/descriptions.mjs" --write >/dev/null
# A language with no CurseForge page of its own ships the English description
# rather than nothing: the page it was downloaded from is the honest fallback
# until somebody writes one for it.
# Named by CurseForge slug, which is what descriptions.mjs writes the files out as -- not by
# folder, which still carries the pre-rename name.
#
# The retired 64 kbps page is gone, so every tier without a page of its own falls back to the
# one shipping description rather than to a page nobody maintains.
#
# A language's pack has a page of its own, publishers/places/spoken-places-audio-<lang>.md, and
# ships that; until one exists it falls back the same way.
tier_readme() {
  if ! english; then echo "$REPO/dist/descriptions/$PACK_SLUG.md"; return; fi
  echo "$REPO/dist/descriptions/$(node "$REPO/scripts/lib/packs.mjs" get places enUS - slug).md"
}

# English's CurseForge project is "Spoken Audio: Places and Bosses": the bosses pack has no project
# there, so English gets a second zip, the plain one plus dist/SpokenBossesAudio, which is what that
# project is sent. The plain zip stays Places only, because the manager refuses a zip holding a
# folder its product does not own, and GitHub's places release is where it installs from. The
# bosses folder is copied from what `make bosses-package-audio` built, never rebuilt here, and a
# missing or stale build stops the run: a CurseForge zip quietly shipped without it takes the boss
# narration away from every player who updates. Stale means a version other than its .toc's, or a
# lookup other than the one the last `make bosses-lookup` wrote.
BOSSES_SRC="$REPO/addons/SpokenBossesAudio"
BOSSES_DIST="$DIST/SpokenBossesAudio"
BOSSES_REMEDY="run make bosses-sync bosses-pull-live bosses-package-audio"
# A name of its own, not SpokenPlacesAudio-<v>-something: the manager would take that for a places
# asset, and the channel publisher would read dist/SpokenPlacesAudio as older than its zip.
BUNDLE_NAME="SpokenPlacesAndBossesAudio"
bundles_bosses() { english && [[ "$1" == high ]]; }
check_bosses_build() {
  local want built
  want="$(toc_version "$BOSSES_SRC/SpokenBossesAudio.toc")"
  if [[ ! -f "$BOSSES_DIST/SpokenBossesAudio.toc" ]]; then
    echo "error: $BOSSES_DIST is not built, and English's CurseForge zip carries it -- $BOSSES_REMEDY" >&2
    exit 1
  fi
  built="$(toc_version "$BOSSES_DIST/SpokenBossesAudio.toc")"
  if [[ "$built" != "$want" ]]; then
    echo "error: $BOSSES_DIST is version '$built', its .toc says '$want' -- $BOSSES_REMEDY" >&2
    exit 1
  fi
  if ! cmp -s "$BOSSES_SRC/Data/Sounds.lua" "$BOSSES_DIST/Data/Sounds.lua"; then
    echo "error: $BOSSES_DIST was built from another lookup than $BOSSES_SRC/Data/Sounds.lua -- $BOSSES_REMEDY" >&2
    exit 1
  fi
  if [[ -z "$(find "$BOSSES_DIST/Sounds" -name '*.mp3' -print -quit 2>/dev/null)" ]]; then
    echo "error: $BOSSES_DIST has no clips -- $BOSSES_REMEDY" >&2
    exit 1
  fi
}
for tier in "${tiers[@]}"; do
  if bundles_bosses "$tier"; then check_bosses_build; break; fi
done

# Transcoding needs ffmpeg, but only for the tiers that are not a straight copy.
for tier in "${tiers[@]}"; do
  if [[ "$(tier_encoding "$tier")" != "copy" ]]; then
    command -v ffmpeg >/dev/null || { echo "error: ffmpeg is required to build the $tier tier" >&2; exit 1; }
    break
  fi
done

mkdir -p "$DIST"

for tier in "${tiers[@]}"; do
  folder="$(tier_folder "$tier")"
  bitrate="$(tier_bitrate "$tier")"
  encoding="$(tier_encoding "$tier")"
  title="$(tier_title "$tier")"
  zip_path="$DIST/$folder-$version.zip"
  bundle_path="$DIST/$BUNDLE_NAME-$version.zip"

  echo
  echo "=== $tier tier -> $folder ($encoding, nominal ${bitrate}kbps) ==="
  rm -f "$zip_path"
  bundles_bosses "$tier" && rm -f "$bundle_path"

  staging="$(mktemp -d)"
  trap 'rm -rf "$staging"' EXIT
  mkdir -p "$staging/$folder"

  # Everything except the audio and the lookup is copied from English's source; the audio is
  # either re-encoded or copied into place and the lookup is this language's, so the tree the
  # client sees is identical apart from those and the .toc lines rewritten below.
  rsync -a --exclude 'Sounds/' --exclude 'Data/Sounds.lua' --exclude '.DS_Store' "$SRC/" "$staging/$folder/"
  # A language's pack wears the shield with its badge, so it is not mistaken for English's in
  # the AddOns list. `make places-icon` makes these from the PNGs beside them.
  english || cp "$REPO/pipelines/places/assets/spoken-zones-$LOCALE.tga" "$staging/$folder/Textures/AddonIcon.tga"
  mkdir -p "$staging/$folder/Data"
  # -p, not a bare cp: this used to arrive through the rsync -a below before Sounds.lua was
  # split out of it, and a plain cp stamps the copy with "now" instead of preserving the
  # source's mtime, which is a zip entry that no longer matches master's byte for byte.
  cp -p "$LOOKUP" "$staging/$folder/Data/Sounds.lua"
  # The .toc must be named after its folder. The source tier already is, and mv
  # onto itself is an error rather than a no-op.
  if [[ "$folder" != "$(basename "$SRC")" ]]; then
    mv "$staging/$folder/$(basename "$SRC").toc" "$staging/$folder/$folder.toc"
  fi
  cp "$(tier_readme "$tier")" "$staging/$folder/README.md"

  # The .toc is the only place the tier is recorded. Data/Sounds.lua reads these
  # back through GetAddOnMetadata, which is what lets one generated file serve
  # every tier.
  #
  # ## Interface is deliberately NOT rewritten here: the clients a pack loads on
  # are a property of the audio, which is identical across tiers, not of the tier.
  # It comes through from the source .toc so both tiers can only ever agree.
  # IconTexture names the folder it lives in, and the standard tier's folder is not
  # the source's -- an unrewritten path points at an addon the player may not have
  # installed, which the client answers with no icon at all rather than an error.
  sed -i.bak \
    -e "s|^## IconTexture:.*|## IconTexture: Interface\\\\AddOns\\\\$folder\\\\Textures\\\\AddonIcon.tga|" \
    -e "s~^## Title:.*~## Title: ${title/#Spoken/|cffb48cffSpoken|r}~" \
    -e "s|^## Version:.*|## Version: $version|" \
    -e "s|^## X-SpokenPlaces-Quality:.*|## X-SpokenPlaces-Quality: $tier|" \
    -e "s|^## X-SpokenPlaces-Bitrate:.*|## X-SpokenPlaces-Bitrate: $bitrate|" \
    -e "s|^## X-SpokenPlaces-Language:.*|## X-SpokenPlaces-Language: $LOCALE|" \
    "$staging/$folder/$folder.toc"
  rm -f "$staging/$folder/$folder.toc.bak"

  if [[ "$encoding" == "copy" ]]; then
    # No transcode, but ~790MB of copying is still a long silence.
    echo "copying $count masters..."
    rsync -a --exclude '.DS_Store' --exclude '*.part' "$SOUNDS/" "$staging/$folder/Sounds/"
  else
    cache="$CACHE_ROOT/$encoding"
    mkdir -p "$cache"

    # Three passes rather than one loop, because only the middle one is expensive
    # and only it is worth spreading over the cores: checksum every master to
    # learn its cache key, encode the keys that are missing, then place them.
    plan="$(mktemp)"
    find "$SOUNDS" -name '*.mp3' -print0 \
      | xargs -0 -P "$JOBS" -n 1 bash -c 'printf "%s\t%s\n" "$(checksum "$1")" "$1"' _ \
      >"$plan"

    # Deduplicated, because two identical masters share a key and must not become
    # two workers writing the same cache entry.
    todo="$(mktemp)"
    sort -u -t"$(printf '\t')" -k1,1 "$plan" | while IFS=$'\t' read -r key file; do
      [[ -f "$cache/$key.mp3" ]] || printf '%s\t%s\n' "$key" "$file"
    done >"$todo"

    encoded="$(wc -l <"$todo" | tr -d ' ')"
    hits=$((count - encoded))

    if (( encoded > 0 )); then
      # Minutes of ffmpeg with nothing on stdout is indistinguishable from a hang.
      # The count has to come from a file rather than a variable: each worker is
      # its own process, so an incremented shell variable would die with it.
      progress_file="$(mktemp)"
      export CACHE="$cache" PROGRESS="$progress_file" TOTAL="$encoded"
      encode_one() {
        # Via .part and mv, so an interrupted run cannot leave a truncated file
        # under a name that claims to be a complete encode of that checksum. The
        # pid is in there too, so a second copy of this script running against the
        # same cache cannot land in the other's scratch file.
        # -f mp3 is required with it: ffmpeg picks the muxer from the extension,
        # and ".part" is not one it knows.
        # VBR (-q:a 6, ~50kbps effective on mono speech) rather than CBR: the bits
        # follow the voice instead of padding silence to a constant rate. Nominal
        # tier stays "64" in the pack name and .toc.
        local part="$CACHE/$2.$$.part"
        ffmpeg -nostdin -loglevel error -f mp3 -i "$1" \
          -codec:a libmp3lame -q:a 6 -ac 1 -f mp3 "$part"
        mv "$part" "$CACHE/$2.mp3"

        # One byte appended per finished file; short appends to O_APPEND do not
        # interleave, so the size is the count.
        printf '.' >>"$PROGRESS"
        local n
        n="$(wc -c <"$PROGRESS" | tr -d ' ')"
        # On a terminal the count is rewritten in place; piped to a file or a CI
        # log, \r would produce one unreadable line, so there it is every 100.
        if [[ -t 1 ]]; then
          printf '\r  %4d/%-4d encoded' "$n" "$TOTAL"
        elif (( n % 100 == 0 || n == TOTAL )); then
          echo "  $n/$TOTAL encoded"
        fi
      }
      export -f encode_one

      echo "encoding $encoded files ($encoding, mono) across $JOBS jobs (cache: $cache)"
      echo "  $hits of $count already cached"
      tr '\t\n' '\0\0' <"$todo" \
        | xargs -0 -P "$JOBS" -n 2 bash -c 'encode_one "$1" "$0"'
      [[ -t 1 ]] && printf '\n'
      rm -f "$progress_file"
    else
      echo "all $count files already cached ($encoding, $cache)"
    fi

    # Directories first in one pass, so placing the clips is a flat run of cp
    # rather than 1353 mkdir processes.
    rsync -a -f'+ */' -f'- *' "$SOUNDS/" "$staging/$folder/Sounds/"
    while IFS=$'\t' read -r key file; do
      cp "$cache/$key.mp3" "$staging/$folder/Sounds/${file#"$SOUNDS"/}"
    done <"$plan"

    # Entries for masters that have since been re-cut or deleted. Without this the
    # cache keeps every superseded encode forever, which is what audio-history/ is
    # for and this is not.
    pruned=0
    while IFS= read -r stale; do
      [[ -n "$stale" ]] || continue
      rm -f "$cache/$stale"
      pruned=$((pruned + 1))
    done < <(comm -23 \
      <(find "$cache" -name '*.mp3' -exec basename {} \; | sort) \
      <(cut -f1 "$plan" | sed 's/$/.mp3/' | sort -u) || true)
    rm -f "$plan" "$todo"

    echo "  $hits reused, $encoded encoded, $pruned superseded entries dropped"
  fi

  echo "zipping $folder..."

  (cd "$staging" && zip -r -q -X "$zip_path" "$folder" \
    -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig' '*.part')
  # Stored, not deflated: the clips are mp3s already, and deflating them buys nothing for the time.
  if bundles_bosses "$tier"; then
    echo "zipping $BUNDLE_NAME, with SpokenBossesAudio $(toc_version "$BOSSES_DIST/SpokenBossesAudio.toc")..."
    cp "$zip_path" "$bundle_path"
    (cd "$DIST" && zip -r -0 -q -X "$bundle_path" SpokenBossesAudio \
      -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig' '*.part')
  fi

  # The manager channel publishes dist/<folder>/, so it must hold the tree the zip holds.
  rm -rf "$DIST/$folder"
  rsync -a --exclude '.DS_Store' --exclude '.git' --exclude '*.bak' --exclude '*.orig' --exclude '*.part' \
    "$staging/$folder/" "$DIST/$folder/"
  # rsync keeps mtimes, and publish.mjs reads a .toc older than the zip as a stale build.
  touch "$DIST/$folder/$folder.toc"

  rm -rf "$staging"
  trap - EXIT

  files="$(unzip -Z1 "$zip_path" | grep -cv '/$')"
  size="$(du -h "$zip_path" | cut -f1)"
  echo "built $zip_path"
  echo "  version: $version   files: $files   size: $size   encoding: $encoding"
  if bundles_bosses "$tier"; then
    echo "built $bundle_path, for CurseForge"
    echo "  files: $(unzip -Z1 "$bundle_path" | grep -cv '/$')   size: $(du -h "$bundle_path" | cut -f1)"
  fi
done
