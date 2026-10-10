#!/usr/bin/env bash
# Builds the Spoken Gossip zip for Blizzard's clients.
#
#   ./scripts/gossip/package.sh                 # dist/Spoken_Gossip-<version>.zip
#   ALLOW_DIRTY=1 ./scripts/gossip/package.sh   # build from an uncommitted tree
#
# One zip, flavor-suffixed .toc files, and the client picks. It ships inside Spoken's zip
# (scripts/spoken/package.sh), as the other modules do; this builds the copy that one unpacks.
#
# The legacy clients (1.12, 2.4.3, 3.3.5) read one unsuffixed .toc and have no addon manager, so
# their zips are the quests addon's, which carry Spoken and this module pruned for each client
# (scripts/quests/package.sh): one download there, quests and gossip, as before the split.
#
# There is no sound pack here: gossip is voiced by the quests packs (the Gossip pack, the complete
# one, and each language's), which scripts/quests/package-audio.sh builds.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="Spoken_Gossip"
SRC="$REPO/addons/$NAME"
TOC="$SRC/$NAME.toc"
DIST="${DIST:-$REPO/dist}"
LEGACY_CLIENTS=(1.12 2.4.3 3.3.5)

[ -f "$TOC" ] || { echo "error: $TOC not found" >&2; exit 1; }
version="$(sed -n 's/^## Version:[[:space:]]*//p' "$TOC" | head -1 | tr -d '\r')"
[ -n "$version" ] || { echo "error: no '## Version:' line in $TOC" >&2; exit 1; }

# A zip built from uncommitted edits cannot be traced back to a commit later.
if [ -z "${ALLOW_DIRTY:-}" ] && git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  if [ -n "$(git -C "$REPO" status --porcelain -- "addons/$NAME")" ]; then
    echo "error: addons/$NAME/ has uncommitted changes." >&2
    echo "       Commit them, or re-run with ALLOW_DIRTY=1 to package anyway." >&2
    exit 1
  fi
fi

# Every variant carries one version and lists only files that exist: a .toc listing a missing
# file is an addon that half-loads on somebody else's machine. The legacy variants are checked
# too, since the quests addon's zips ship them and nothing else would notice them going wrong.
for toc in "$SRC"/*.toc; do
  missing=()
  while IFS= read -r entry; do
    [ -f "$SRC/$(printf '%s' "$entry" | tr '\\' '/')" ] || missing+=("$entry")
  # A trailing load directive ("Gossip\deDE.lua [AllowLoadTextLocale deDE]") is not the path.
  done < <(sed -E -e 's/#.*//' -e 's/[[:space:]]*(\[[^]]*\])?[[:space:]]*$//' "$toc" | tr -d '\r' \
             | grep -E '\.(lua|xml)$' || true)
  toc_version="$(sed -n 's/^## Version:[[:space:]]*//p' "$toc" | head -1 | tr -d '\r')"
  [ "$toc_version" = "$version" ] || { echo "error: $(basename "$toc") says $toc_version, $NAME.toc says $version" >&2; exit 1; }
  if [ ${#missing[@]} -gt 0 ]; then
    echo "error: $(basename "$toc") lists files that do not exist:" >&2
    printf '       %s\n' "${missing[@]}" >&2
    exit 1
  fi
done

# Environment.lua carries the version as a literal, because it loads before the addon has any
# metadata API to ask. /spg diagnostics prints it.
env_version="$(sed -n 's/.*AddonVersion = "\([^"]*\)".*/\1/p' "$SRC/Environment.lua" | head -1)"
[ "$env_version" = "$version" ] || { echo "error: Environment.lua says $env_version, $NAME.toc says $version" >&2; exit 1; }

# UI/Layout.lua is byte-identical across every Spoken addon; pipelines/quests/tests/test_package.py
# enforces it on the tree, and this catches a copy that diverged before it ships.
for other in Spoken Spoken_Quests Spoken_Zones Spoken_Books; do
  peer="$REPO/addons/$other/UI/Layout.lua"
  [ -f "$peer" ] || continue
  cmp -s "$SRC/UI/Layout.lua" "$peer" || { echo "error: UI/Layout.lua differs from addons/$other/UI/Layout.lua" >&2; exit 1; }
done

mkdir -p "$DIST"
zip_path="$DIST/$NAME-$version.zip"
rm -f "$zip_path"

# Staged so the archive root is the installed folder name: addon hosts unpack the zip straight
# into Interface/AddOns.
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/$NAME"
(cd "$SRC" && tar -cf - --exclude '.DS_Store' --exclude '*.bak' --exclude '*.orig' .) \
  | (cd "$staging/$NAME" && tar -xf -)

# A Blizzard client loads none of the legacy clients' trees or .toc files, and the trees are most
# of the folder.
excludes=()
for client in "${LEGACY_CLIENTS[@]}"; do
  excludes+=("$NAME/$client/*" "$NAME/${NAME}_$client.toc")
done
(cd "$staging" && zip -r -q -X "$zip_path" "$NAME" -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig' "${excludes[@]}")

echo "built $(basename "$zip_path")   files: $(unzip -Z1 "$zip_path" | grep -cv '/$')   size: $(du -h "$zip_path" | cut -f1)"
