#!/usr/bin/env bash
# Builds the bosses sound pack, SpokenBossesAudio, into dist/.
#
#   ./scripts/bosses/package-audio.sh               # English's pack
#   LOCALE=deDE ./scripts/bosses/package-audio.sh   # another language's pack
#
# Run through `make bosses-package-audio`, which first checks the data against production and
# assembles Sounds/ and the lookup (bosses-sounds, bosses-lookup) and validates them
# (bosses-validate-audio). English's clips and lookup are in its folder; a language's are build
# output under build/bosses/<lang>/, wrapped in English's folder and named by its page under
# publishers/bosses/ (scripts/lib/packs.mjs).
#
# One tier, copied as cut: places' 64 kbps tier is retired, and the bosses never had one. The
# .toc names the tier and bitrate, and Data/Sounds.lua reads them back at load time.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The Node steps read the takes from Postgres; DATABASE_URL comes from the repo-root .env.
LOCALE="${LOCALE:-enUS}"
if [[ ! "$LOCALE" =~ ^[a-z]{2}[A-Z]{2}$ ]]; then
  echo "error: LOCALE=$LOCALE is not a language code (e.g. deDE)" >&2
  exit 1
fi
english() { [[ "$LOCALE" == "enUS" ]]; }

# The source is always English's folder: the .toc, README and icon come from it in every language.
SRC="$REPO/addons/SpokenBossesAudio"
TOC="$SRC/SpokenBossesAudio.toc"
DIST="$REPO/dist"
[[ -f "$TOC" ]] || { echo "error: $TOC not found" >&2; exit 1; }

pack_field() { node "$REPO/scripts/lib/packs.mjs" get bosses "$LOCALE" - "$1"; }
folder="$(pack_field folder)"
title="$(pack_field name)"
slug="$(pack_field slug)"

if english; then
  SOUNDS="$SRC/Sounds"
  LOOKUP="$SRC/Data/Sounds.lua"
  version="$(sed -n 's/^## Version:[[:space:]]*//p' "$TOC" | head -1 | tr -d '\r')"
  next="make bosses-pull-live bosses-sounds bosses-lookup"
else
  WORK="$REPO/build/bosses/$LOCALE"
  SOUNDS="$WORK/Sounds"
  LOOKUP="$WORK/Data/Sounds.lua"
  version="$(pack_field version)"
  next="make bosses-pull-live bosses-sounds bosses-lookup LOCALE=$LOCALE"
fi
[[ -n "$version" ]] || { echo "error: no version for the $LOCALE bosses pack" >&2; exit 1; }

# The language is set by rewriting this line, so a .toc without it would ship a pack that
# reports itself as English and plays under English text only.
grep -q '^## X-SpokenBosses-Language:' "$TOC" \
  || { echo "error: $TOC has no '## X-SpokenBosses-Language:' line to rewrite" >&2; exit 1; }

count="$(find "$SOUNDS" -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ' || true)"
if [[ "$count" -eq 0 ]]; then
  echo "error: no mp3 files in $SOUNDS" >&2
  echo "       Generate some first, on the site, then:  $next" >&2
  exit 1
fi
[[ -f "$LOOKUP" ]] || { echo "error: no $LOOKUP -- $next" >&2; exit 1; }

# The README a player gets is the page they read before downloading.
node "$REPO/scripts/descriptions.mjs" --write >/dev/null

mkdir -p "$DIST"
zip_path="$DIST/$folder-$version.zip"
rm -f "$zip_path"

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/$folder/Data"

rsync -a --exclude 'Sounds/' --exclude 'Data/Sounds.lua' --exclude '.DS_Store' "$SRC/" "$staging/$folder/"
cp -p "$LOOKUP" "$staging/$folder/Data/Sounds.lua"
# The .toc is named after its folder; English's already is, and mv onto itself is an error.
[[ "$folder" == SpokenBossesAudio ]] || mv "$staging/$folder/SpokenBossesAudio.toc" "$staging/$folder/$folder.toc"
cp "$REPO/dist/descriptions/$slug.md" "$staging/$folder/README.md"

# ## Interface is not rewritten: the clients a pack loads on are the source .toc's.
sed -i.bak \
  -e "s|^## IconTexture:.*|## IconTexture: Interface\\\\AddOns\\\\$folder\\\\Textures\\\\AddonIcon.tga|" \
  -e "s~^## Title:.*~## Title: ${title/#Spoken/|cffb48cffSpoken|r}~" \
  -e "s|^## Version:.*|## Version: $version|" \
  -e "s|^## X-SpokenBosses-Quality:.*|## X-SpokenBosses-Quality: high|" \
  -e "s|^## X-SpokenBosses-Bitrate:.*|## X-SpokenBosses-Bitrate: 128|" \
  -e "s|^## X-SpokenBosses-Language:.*|## X-SpokenBosses-Language: $LOCALE|" \
  "$staging/$folder/$folder.toc"
rm -f "$staging/$folder/$folder.toc.bak"

echo "copying $count clips..."
rsync -a --exclude '.DS_Store' --exclude '*.part' --exclude '.from-takes' "$SOUNDS/" "$staging/$folder/Sounds/"

# Stored, not deflated: the payload is mp3.
(cd "$staging" && zip -r -0 -q -X "$zip_path" "$folder" -x '*.DS_Store' '*/.*')

# The manager channel publishes dist/<folder>/, so it must hold the tree the zip holds.
rm -rf "${DIST:?}/$folder"
rsync -a --exclude '.[!.]*' "$staging/$folder/" "$DIST/$folder/"
# rsync keeps mtimes, and publish.mjs reads a .toc older than the zip as a stale build.
touch "$DIST/$folder/$folder.toc"

files="$(unzip -Z1 "$zip_path" | grep -cv '/$')"
echo "built $zip_path"
echo "  version: $version   files: $files   clips: $count   size: $(du -h "$zip_path" | cut -f1)"
