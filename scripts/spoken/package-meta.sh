#!/usr/bin/env bash
# Builds the English meta addon: an install of nothing, which drags every Spoken addon and every
# English sound pack in behind it.
#
#   make package-spoken-all                 # dist/SpokenAll-<version>.zip
#   VERSION=3.0.0 make package-spoken-all   # the version written into the .toc
#
# The same mechanism as Spoken Quests Audio: All (scripts/quests/package-meta.sh), one level up:
# a CurseForge file can declare required dependencies, and both the CurseForge app and WowUp
# install them. This folder owns nothing; scripts/quests/release.sh holds the dependency list
# (target_dependencies, spoken-all) and sends it with the upload. A manual download gets the
# stub alone, which is why the page says to install it through the app.
#
# CurseForge only. Wago's uploads carry no dependency list, so there it would install an empty
# folder and nothing else -- it has no Wago project and release.sh names none.
#
# NO DataModule KEYS, for the reason package-meta.sh gives: the quests player enumerates packs
# by that key, and a stub carrying it would count as an installed pack.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

NAME="${NAME:-SpokenAll}"
DIST="${DIST:-$REPO/dist}"
VERSION="${VERSION:-3.0.0}"
ZIP="${ZIP:-1}"
TITLE="${TITLE:-Spoken Everything: Quests, Zones, Books AI Voiceover}"

module_dir="$DIST/$NAME"
rm -rf "$module_dir"
mkdir -p "$module_dir"

cat > "$module_dir/Meta.lua" <<'LUA'
-- Intentionally empty. This addon exists to pull in every Spoken addon and English sound pack
-- as CurseForge dependencies; it holds no audio and no code of its own.
LUA

# The player's artwork, since this is the Spoken family as a whole rather than one addon of it.
cp "$REPO/pipelines/quests/assets/icon/spoken-player.tga" "$module_dir/icon.tga"

cat > "$module_dir/$NAME.toc" <<TOC
## Interface: 100000, 11509, 20506, 16001
## Title: $TITLE
## Notes: Installs every Spoken addon with its English audio - quests, gossip, zone lore and books.|n|nThis addon holds no audio itself. If your addon manager did not fetch the rest with it, install them from CurseForge; |cFFFFD200Spoken Player|r says what is missing.
## Version: $VERSION
## IconTexture: Interface\\AddOns\\$NAME\\icon.tga
## Group: Spoken
## X-Part-Of: Spoken

Meta.lua
TOC

echo "built $module_dir ($(du -sh "$module_dir" | cut -f1))"

if [ "$ZIP" = 1 ]; then
  zip_path="$(cd "$DIST" && pwd)/$NAME-$VERSION.zip"
  rm -f "$zip_path"
  (cd "$DIST" && zip -r -q -X "$zip_path" "$NAME" -x '*.DS_Store')
  echo "==> $zip_path ($(du -h "$zip_path" | cut -f1))"
fi
