#!/usr/bin/env bash
# Builds the meta addon: an install of nothing, which drags the four sound packs in behind it.
#
#   make quests-package-meta          # dist/SpokenQuestsAudio-<version>.zip
#   VERSION=1.4.0 make quests-package-meta   # the version written into the .toc
#
# WHY THIS EXISTS. One folder holding every line cannot be uploaded: 577 MB comes back from Cloudflare as
# a 413 before CurseForge sees the body, which is why the audio ships split four ways in the
# first place. But "install everything with one click" is still worth having, and CurseForge
# already has the mechanism - a file can declare required dependencies on other projects, and
# both the CurseForge app and WowUp install those automatically. So this is a few kilobytes
# that owns no audio and lists the four packs as dependencies; scripts/release.sh sends that
# list with the upload.
#
# Bundling the four folders into one zip instead would not help twice over: the zip would be
# the same 565 MB and hit the same limit, and those folder names would then be owned by two
# projects at once, so a manager tracking Alliance from both would update each over the other.
#
# NO DataModule KEYS OF EITHER GENERATION (X-SpokenQuests-* or X-VoiceOver-*), deliberately. The player enumerates packs by that key, so a
# stub carrying it would count as an installed pack: somebody holding only this would be told
# nothing is missing while hearing silence. See DataModules:EnumerateAddons.
#
# IT TAKES THE BARE SpokenQuestsAudio NAME (make passes NAME=SpokenQuestsAudio), which the split
# packs left free. That name is what the pre-split pack used, so a player updating from it has their old 1.5 GB folder
# replaced by this stub and the packs installed alongside - the migration falls out of the
# rename rather than needing anything.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

NAME="${NAME:-VoiceOverReduxAudio}"
DIST="${DIST:-$REPO/dist}"
VERSION="${VERSION:-2.0.0}"
ZIP="${ZIP:-1}"
# What this stub is called and which packs it describes. A set of packs built together needs a
# stub of its own, because the stub is a CurseForge project like any other; release.sh holds the
# dependency list that does the actual work.
TITLE="${TITLE:-Spoken Quests Audio: All}"
VARIANT="${VARIANT:-}"

module_dir="$DIST/$NAME"
rm -rf "$module_dir"
mkdir -p "$module_dir"

# A comment and nothing else. The addon has to list a file to be a well-formed addon, and this
# one deliberately does nothing: every behaviour lives in the player, and every sound in a pack.
cat > "$module_dir/Meta.lua" <<'LUA'
-- Intentionally empty. This addon exists to pull in the Spoken Quests sound packs as
-- CurseForge dependencies; it holds no audio and no code of its own.
LUA

# The same artwork every pack carries, so the five sit together in the AddOns list instead of
# one of them showing the client's red question mark. See tools/make_icon.py.
cp "$REPO/pipelines/quests/assets/icon/spoken-quests.tga" "$module_dir/icon.tga"

cat > "$module_dir/$NAME.toc" <<TOC
## Interface: 11509, 20506, 16001
## Title: ${TITLE/#Spoken/|cffb48cffSpoken|r}
## Notes: Installs every Spoken Quests sound pack$VARIANT - Alliance, Horde, Shared Quests and Gossip.|n|nThis addon holds no audio itself. If your addon manager did not fetch the four packs with it, install them yourself; Spoken Quests plays whatever it finds.
## Version: $VERSION
## IconTexture: Interface\\AddOns\\$NAME\\icon.tga
## Group: Spoken
## X-Part-Of: Spoken
## X-Child-Of: Spoken_Quests

Meta.lua
TOC

echo "built $module_dir ($(du -sh "$module_dir" | cut -f1))"

if [ "$ZIP" = 1 ]; then
  zip_path="$(cd "$DIST" && pwd)/$NAME-$VERSION.zip"
  rm -f "$zip_path"
  (cd "$DIST" && zip -r -q -X "$zip_path" "$NAME" -x '*.DS_Store')
  echo "==> $zip_path ($(du -h "$zip_path" | cut -f1))"
fi
