#!/usr/bin/env bash
# A language's readables sound pack, staged from English's folder and zipped into dist/.
#
#   LOCALE=esMX ./scripts/readables/package-audio.sh
#
# English's pack is still zipped in place by `make readables-package-audio`: its folder is the pack.
# Another language's is not in the tree at all -- its clips and table are build output under
# build/readables/<lang>/ (make readables-sounds / readables-lookup LOCALE=..) -- so this copies English's
# folder around them, and its page under publishers/readables/ says what it is called and which
# version it is.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCALE="${LOCALE:?set LOCALE, e.g. LOCALE=esMX}"
[[ "$LOCALE" != enUS ]] || { echo "error: English's pack is \`make readables-package-audio\`" >&2; exit 1; }

SRC="$REPO/addons/SpokenReadablesAudio"
WORK="$REPO/build/readables/$LOCALE"
DIST="$REPO/dist"
pack_field() { node "$REPO/scripts/lib/packs.mjs" get readables "$LOCALE" - "$1"; }
folder="$(pack_field folder)"; title="$(pack_field name)"
version="$(pack_field version)"; slug="$(pack_field slug)"

count="$(find "$WORK/Sounds" -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ')"
[[ "$count" -gt 0 ]] || { echo "error: no mp3 files in $WORK/Sounds -- make readables-pull-live readables-sounds LOCALE=$LOCALE" >&2; exit 1; }
[[ -f "$WORK/Data/Sounds.lua" ]] || { echo "error: no $WORK/Data/Sounds.lua -- make readables-lookup LOCALE=$LOCALE" >&2; exit 1; }

node "$REPO/scripts/descriptions.mjs" --write >/dev/null
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/$folder/Data"
rsync -a --exclude 'Sounds/' --exclude 'Data/Sounds.lua' --exclude '.DS_Store' "$SRC/" "$staging/$folder/"
# English's icon with this language's badge (`make readables-icon`).
cp "$REPO/pipelines/readables/assets/spoken-books-$LOCALE.tga" "$staging/$folder/Textures/AddonIcon.tga"
mv "$staging/$folder/SpokenReadablesAudio.toc" "$staging/$folder/$folder.toc"
cp "$REPO/dist/descriptions/$slug.md" "$staging/$folder/README.md"
cp "$WORK/Data/Sounds.lua" "$staging/$folder/Data/Sounds.lua"
rsync -a --exclude '.DS_Store' "$WORK/Sounds/" "$staging/$folder/Sounds/"
sed -i.bak \
  -e "s~^## Title:.*~## Title: ${title/#Spoken/|cffb48cffSpoken|r}~" \
  -e "s|^## Version:.*|## Version: $version|" \
  -e "s|^## X-SpokenReadables-Language:.*|## X-SpokenReadables-Language: $LOCALE|" \
  -e "s|^## IconTexture:.*|## IconTexture: Interface\\\\AddOns\\\\$folder\\\\Textures\\\\AddonIcon.tga|" \
  "$staging/$folder/$folder.toc"
rm -f "$staging/$folder/$folder.toc.bak"

mkdir -p "$DIST"
zip_path="$DIST/$folder-$version.zip"
rm -f "$zip_path"
# Stored, not deflated, as English's: the payload is mp3.
(cd "$staging" && zip -r -0 -q -X "$zip_path" "$folder" -x '*.DS_Store' '*/.*')
# The manager channel publishes dist/<folder>/, so it must hold the tree the zip holds.
rm -rf "$DIST/$folder"
rsync -a --exclude '.[!.]*' "$staging/$folder/" "$DIST/$folder/"
# rsync keeps mtimes, and publish.mjs reads a .toc older than the zip as a stale build.
touch "$DIST/$folder/$folder.toc"
echo "built dist/$folder-$version.zip ($count mp3, $(du -h "$zip_path" | cut -f1))"
