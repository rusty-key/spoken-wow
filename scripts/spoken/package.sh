#!/usr/bin/env bash
# Builds Spoken's zip for Blizzard's clients: Spoken itself and its modules, Quests, Books
# and Zones, in one download.
#
#   ./scripts/spoken/package.sh                 # dist/Spoken-<version>.zip
#   ALLOW_DIRTY=1 ./scripts/spoken/package.sh   # build from an uncommitted tree
#
# One zip, flavor-suffixed .toc files, and the client picks. Every module comes installed; a
# player who does not want one switches it off on its card in Spoken's settings or deletes its
# folder. The sound packs stay separate downloads: 280-452 MB each, one per language.
#
# There are no legacy-client zips of Spoken: those clients have no addon manager, so the quests
# addon's 1.12/2.4.3/3.3.5 zips carry Spoken inside them (scripts/quests/package.sh).
#
# The modules' folders are Spoken_Quests, Spoken_Books and Spoken_Zones. Their old names,
# SpokenQuests and the rest, belong to the retired CurseForge projects, and this zip carries no
# tombstone under them: two projects shipping one folder is what the rename exists to stop. The
# retired projects' last releases carry those (scripts/spoken/package-retired.sh).
#
# Spoken_Developer (the debug log and the Developer page) is not in this zip: it is a download of
# its own (scripts/developer/package.sh), for whoever tries Spoken out or is asked for a log.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="Spoken"
SRC="$REPO/addons/$NAME"
TOC="$SRC/$NAME.toc"
DIST="${DIST:-$REPO/dist}"
# Shipped beside the player in the same zip: a folder with one .toc and no Lua, which exists so
# the gathered lines a player uploads are in a file named SpokenContributions.lua rather than
# inside the player's own settings file. See its .toc.
STORE="SpokenContributions"
STORE_SRC="$REPO/addons/$STORE"
LEGACY_CLIENTS=(1.12 2.4.3 3.3.5)

[ -f "$TOC" ] || { echo "error: $TOC not found" >&2; exit 1; }
version="$(sed -n 's/^## Version:[[:space:]]*//p' "$TOC" | head -1 | tr -d '\r')"
[ -n "$version" ] || { echo "error: no '## Version:' line in $TOC" >&2; exit 1; }

if [ -z "${ALLOW_DIRTY:-}" ] && git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  if [ -n "$(git -C "$REPO" status --porcelain -- "addons/$NAME" "addons/$STORE" "addons/SpokenPlayer")" ]; then
    echo "error: addons/$NAME/ has uncommitted changes." >&2
    echo "       Commit them, or re-run with ALLOW_DIRTY=1 to package anyway." >&2
    exit 1
  fi
fi

# Every .toc variant carries one version, and Environment.lua's literal agrees with it.
for toc in "$SRC"/*.toc; do
  v="$(sed -n 's/^## Version:[[:space:]]*//p' "$toc" | head -1 | tr -d '\r')"
  [ "$v" = "$version" ] || { echo "error: $(basename "$toc") says $v, $NAME.toc says $version" >&2; exit 1; }
done
literal="$(sed -n 's/^[[:space:]]*AddonVersion = "\(.*\)",/\1/p' "$SRC/Environment.lua" | head -1)"
[ "$literal" = "$version" ] || { echo "error: Environment.lua says $literal but the .toc says $version" >&2; exit 1; }

# Every file a .toc or .xml lists exists.
for toc in "$SRC"/*.toc; do
  while IFS= read -r line; do
    case "$line" in \#*|"") continue;; esac
    f="${line//\\//}"; f="${f%"${f##*[![:space:]]}"}"
    case "$f" in *.lua|*.xml) [ -f "$SRC/$f" ] || { echo "error: $(basename "$toc") lists missing $f" >&2; exit 1; };; esac
  done < "$toc"
done

mkdir -p "$DIST"
zip_path="$DIST/$NAME-$version.zip"
rm -f "$zip_path"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/$NAME"
(cd "$SRC" && tar -cf - --exclude '.DS_Store' --exclude '*.bak' --exclude '*.orig' .) | (cd "$staging/$NAME" && tar -xf -)
mkdir -p "$staging/$STORE"
cp "$STORE_SRC/$STORE.toc" "$staging/$STORE/"
store_version="$(sed -n 's/^## Version:[[:space:]]*//p' "$STORE_SRC/$STORE.toc" | head -1 | tr -d '\r')"
[ "$store_version" = "$version" ] || { echo "error: $STORE.toc says $store_version, $NAME.toc says $version" >&2; exit 1; }

# The SpokenPlayer tombstone, over every .toc name the old player's folder had on these clients.
# shellcheck source=../lib/tombstone.sh
source "$REPO/scripts/lib/tombstone.sh"
TOMBSTONE="SpokenPlayer"
tombstone_version="$(sed -n 's/^## Version:[[:space:]]*//p' "$REPO/addons/$TOMBSTONE/$TOMBSTONE.toc" | head -1 | tr -d '\r')"
[ "$tombstone_version" = "$version" ] || { echo "error: $TOMBSTONE.toc says $tombstone_version, $NAME.toc says $version" >&2; exit 1; }
mkdir -p "$staging/$TOMBSTONE"
for toc in "$SRC"/$NAME.toc "$SRC"/${NAME}_*.toc; do
  suffix="${toc##*/$NAME}"
  case "$suffix" in _1.12.toc|_2.4.3.toc|_3.3.5.toc) continue ;; esac
  tombstone_toc "$REPO/addons/$TOMBSTONE/$TOMBSTONE.toc" "$toc" "$staging/$TOMBSTONE/$TOMBSTONE$suffix"
done

excludes=()
for client in "${LEGACY_CLIENTS[@]}"; do
  excludes+=("$NAME/$client/*" "$NAME/${NAME}_$client.toc")
done
# The modules, each built by its own packager, so this zip carries nothing a module's own
# checks would refuse. A case rather than an associative array: macOS still ships bash 3.2.
module_packager() {
  case "$1" in
    Spoken_Quests) echo "$REPO/scripts/quests/package.sh" ;;
    Spoken_Books) echo "$REPO/scripts/books/package.sh" ;;
    Spoken_Zones) echo "$REPO/scripts/zones/package.sh" ;;
  esac
}
modules_dist="$(mktemp -d)"
trap 'rm -rf "$staging" "$modules_dist"' EXIT
folders=("$NAME" "$STORE" "$TOMBSTONE")
for module in Spoken_Quests Spoken_Books Spoken_Zones; do
  module_version="$(sed -n 's/^## Version:[[:space:]]*//p' "$REPO/addons/$module/$module.toc" | head -1 | tr -d '
')"
  DIST="$modules_dist" "$(module_packager "$module")" >/dev/null
  module_zip="$modules_dist/$module-$module_version.zip"
  [ -f "$module_zip" ] || { echo "error: $(module_packager "$module") did not produce $module_zip" >&2; exit 1; }
  # Two zips holding the same folder would mean one silently overwrote the other's copy.
  for folder in $(unzip -Z1 "$module_zip" | cut -d/ -f1 | sort -u); do
    [ ! -e "$staging/$folder" ] || { echo "error: $folder is in more than one addon's zip" >&2; exit 1; }
    folders+=("$folder")
  done
  unzip -q "$module_zip" -d "$staging"
done

(cd "$staging" && zip -r -q -X "$zip_path" "${folders[@]}" -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig' "${excludes[@]}")
echo "built $(basename "$zip_path")   folders: ${folders[*]}   files: $(unzip -Z1 "$zip_path" | grep -cv '/$')   size: $(du -h "$zip_path" | cut -f1)"
