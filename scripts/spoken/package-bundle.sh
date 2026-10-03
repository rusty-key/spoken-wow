#!/usr/bin/env bash
# Builds Spoken (Bundled): the player and its three modules in a single zip, for a player who
# installs by hand or from a site that cannot fetch dependencies.
#
#   make package-spoken-bundle                 # dist/SpokenBundled-<player version>.zip
#   ALLOW_DIRTY=1 make package-spoken-bundle   # from an uncommitted tree
#
# The separate addons stay as they are. This is built from their own release zips, never from
# the tree, so it cannot carry anything the four separate releases do not: run each addon's
# packager, unpack the four Blizzard-client zips side by side, and zip the lot. One archive may
# hold several addon folders; addon managers and a hand install both unpack it straight into
# Interface/AddOns.
#
# Which modules speak is chosen in the game, on the module cards of Spoken's settings page,
# so leaving one out never means deleting a folder.
#
# NO AUDIO. The sound packs are 280-452 MB each and one per language (see audio-release in the
# Makefile): in one zip they would pass every host's upload limit and make every player download
# every language. Players still get them from each pack's own page, or all at once through the
# CurseForge app with Spoken Everything (package-meta.sh).
#
# NO LEGACY CLIENTS. The 1.12, 2.4.3 and 3.3.5 zips carry their own copy of the player and need
# an archive per client (scripts/quests/package.sh); only the quests addon ships for them.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"
DIST="$REPO/dist"
NAME="SpokenBundled"

version_of() { sed -n 's/^## Version:[[:space:]]*//p' "addons/$1/$1.toc" | head -1 | tr -d '\r'; }
VERSION="${VERSION:-$(version_of SpokenPlayer)}"

# Each packager names its Blizzard zip after the addon and its own version, in dist/. A case
# rather than an associative array: macOS still ships bash 3.2, which has none.
packager_of() {
  case "$1" in
    SpokenPlayer) echo scripts/spoken/package.sh ;;
    SpokenQuests) echo scripts/quests/package.sh ;;
    SpokenZones) echo scripts/zones/package.sh ;;
    SpokenBooks) echo scripts/books/package.sh ;;
  esac
}
ORDER=(SpokenPlayer SpokenQuests SpokenZones SpokenBooks)

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/$NAME"

for addon in "${ORDER[@]}"; do
  echo "==> $addon"
  packager="$(packager_of "$addon")"
  DIST="$DIST" "$packager" >/dev/null
  zip_path="$DIST/$addon-$(version_of "$addon").zip"
  [ -f "$zip_path" ] || { echo "error: $packager did not produce $zip_path" >&2; exit 1; }
  # Two zips holding the same folder would mean one silently overwrote the other's copy.
  while IFS= read -r folder; do
    if [ -e "$staging/$NAME/$folder" ]; then
      echo "error: $folder is in more than one addon's zip" >&2
      exit 1
    fi
  done < <(unzip -Z1 "$zip_path" | cut -d/ -f1 | sort -u)
  unzip -q "$zip_path" -d "$staging/$NAME"
done

out="$DIST/$NAME-$VERSION.zip"
rm -f "$out"
(cd "$staging/$NAME" && zip -r -q -X "$out" . -x '*.DS_Store')
echo "built $(basename "$out")   folders: $(unzip -Z1 "$out" | cut -d/ -f1 | sort -u | tr '\n' ' ')  size: $(du -h "$out" | cut -f1)"
