#!/usr/bin/env bash
# Builds the Places sound pack.
#
#   ./scripts/places/package-audio.sh               # English's pack
#   LOCALE=esMX ./scripts/places/package-audio.sh   # another language's pack
#
# A language other than English is built from build/places/<lang> -- staged there by
# `make places-sounds LOCALE=..` and `make places-lookup LOCALE=..` -- into a folder named and
# versioned by its store page (scripts/lib/packs.mjs).
#
# `make places-sounds` has already made the clips Ogg (or pointers to the site's Oggs, for a
# Manager release), so this only assembles and zips.
#
# Separate from package.sh because the two addons are released on their own
# cadences: most ZoneLore releases do not touch a single voiceline, and the audio
# should not ride along with a Lua bugfix.

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

# The language being packaged. Everything below that names a folder or a title follows
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

# English keeps its folder's name; another language's comes from its page.
if english; then
  folder="SpokenPlacesAudio"
  title="Spoken Audio: Places"
else
  folder="$PACK_FOLDER"
  title="$PACK_TITLE"
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

count="$(find "$SOUNDS" -name '*.ogg' 2>/dev/null | wc -l | tr -d ' ' || true)"
if [[ "$count" -eq 0 ]]; then
  echo "error: no ogg files in $SOUNDS" >&2
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

# The README for the pack's own CurseForge page, so the description a player read before
# downloading is the file they end up with. Named by CurseForge slug, which is what
# descriptions.mjs writes the files out as -- not by folder, which still carries the
# pre-rename name.
node "$REPO/scripts/descriptions.mjs" --write >/dev/null
if english; then
  readme="$REPO/dist/descriptions/$(node "$REPO/scripts/lib/packs.mjs" get places enUS - slug).md"
else
  readme="$REPO/dist/descriptions/$PACK_SLUG.md"
fi

mkdir -p "$DIST"
zip_path="$DIST/$folder-$version.zip"

echo
echo "=== $folder ==="
rm -f "$zip_path"

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/$folder"

# Everything except the audio and the lookup is copied from English's source, so the tree the
# client sees is identical apart from those and the .toc lines rewritten below.
rsync -a --exclude 'Sounds/' --exclude 'Data/Sounds.lua' --exclude '.DS_Store' "$SRC/" "$staging/$folder/"
# A language's pack wears the shield with its badge, so it is not mistaken for English's in
# the AddOns list. `make places-icon` makes these from the PNGs beside them.
english || cp "$REPO/pipelines/places/assets/spoken-zones-$LOCALE.tga" "$staging/$folder/Textures/AddonIcon.tga"
mkdir -p "$staging/$folder/Data"
# -p, not a bare cp: a plain cp stamps the copy with "now" instead of preserving the source's
# mtime, which is a zip entry that no longer matches master's byte for byte.
cp -p "$LOOKUP" "$staging/$folder/Data/Sounds.lua"
# The .toc must be named after its folder, and mv onto itself is an error rather than a no-op.
if [[ "$folder" != "$(basename "$SRC")" ]]; then
  mv "$staging/$folder/$(basename "$SRC").toc" "$staging/$folder/$folder.toc"
fi
cp "$readme" "$staging/$folder/README.md"

# Data/Sounds.lua reads the language back through GetAddOnMetadata, which is what lets one
# generated file serve every language. IconTexture names the folder it lives in: an unrewritten
# path points at an addon the player may not have, which the client answers with no icon at all.
sed -i.bak \
  -e "s|^## IconTexture:.*|## IconTexture: Interface\\\\AddOns\\\\$folder\\\\Textures\\\\AddonIcon.tga|" \
  -e "s~^## Title:.*~## Title: ${title/#Spoken/|cffb48cffSpoken|r}~" \
  -e "s|^## Version:.*|## Version: $version|" \
  -e "s|^## X-SpokenPlaces-Language:.*|## X-SpokenPlaces-Language: $LOCALE|" \
  "$staging/$folder/$folder.toc"
rm -f "$staging/$folder/$folder.toc.bak"

echo "copying $count clips..."
rsync -a --exclude '.DS_Store' --exclude '*.part' --exclude '.from-takes' "$SOUNDS/" "$staging/$folder/Sounds/"

echo "zipping $folder..."
(cd "$staging" && zip -r -q -X "$zip_path" "$folder" \
  -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig' '*.part')

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
echo "  version: $version   files: $files   size: $size"
