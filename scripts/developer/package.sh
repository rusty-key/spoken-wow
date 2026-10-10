#!/usr/bin/env bash
# Builds the Spoken Developer zip: a download of its own, not part of Spoken's one download
# (scripts/spoken/package.sh), so a player who never reports a problem never gets it.
#
#   ./scripts/developer/package.sh                 # dist/Spoken_Developer-<version>.zip
#   ALLOW_DIRTY=1 ./scripts/developer/package.sh   # build from an uncommitted tree
#
# The version comes from `## Version:` in the .toc, so bumping the addon and naming the zip
# stay one edit rather than two.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="Spoken_Developer"
SRC="$REPO/addons/$NAME"
TOC="$SRC/$NAME.toc"
DIST="${DIST:-$REPO/dist}"

[ -f "$TOC" ] || { echo "error: $TOC not found" >&2; exit 1; }
version="$(sed -n 's/^## Version:[[:space:]]*//p' "$TOC" | head -1 | tr -d '\r')"
[ -n "$version" ] || { echo "error: no '## Version:' line in $TOC" >&2; exit 1; }

# A zip built from uncommitted edits cannot be traced back to a tag later.
if [ -z "${ALLOW_DIRTY:-}" ] && git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  if [ -n "$(git -C "$REPO" status --porcelain -- "addons/$NAME")" ]; then
    echo "error: addons/$NAME/ has uncommitted changes." >&2
    echo "       Commit them, or re-run with ALLOW_DIRTY=1 to package anyway." >&2
    exit 1
  fi
fi

# A listed file that does not exist is a load error on somebody else's machine.
missing=()
while IFS= read -r entry; do
  [ -f "$SRC/$entry" ] || missing+=("$entry")
done < <(sed -e 's/#.*//' -e 's/[[:space:]]*$//' "$TOC" | grep -E '\.(lua|xml)$' || true)
if [ ${#missing[@]} -gt 0 ]; then
  echo "error: $NAME.toc lists files that do not exist:" >&2
  printf '       %s\n' "${missing[@]}" >&2
  exit 1
fi

# UI/Layout.lua is byte-identical across every Spoken addon and the packaged copy has to
# stay that way; pipelines/quests/tests/test_package.py enforces it on the tree, and this
# catches a staging copy that somehow diverged from it.
for other in Spoken Spoken_Quests Spoken_Gossip Spoken_Zones Spoken_Books; do
  peer="$REPO/addons/$other/UI/Layout.lua"
  [ -f "$peer" ] || continue
  cmp -s "$SRC/UI/Layout.lua" "$peer" || {
    echo "error: UI/Layout.lua differs from addons/$other/UI/Layout.lua" >&2
    exit 1
  }
done

mkdir -p "$DIST"
zip_path="$DIST/$NAME-$version.zip"
rm -f "$zip_path"

# Staged so the archive root is the installed folder name: addon hosts unpack the zip
# straight into Interface/AddOns, and a zip whose root is addons/ lands the folder where no
# client will look for it.
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/$NAME"
(cd "$SRC" && tar -cf - --exclude '.DS_Store' --exclude '*.bak' --exclude '*.orig' .) \
  | (cd "$staging/$NAME" && tar -xf -)

# -X drops the extended attributes macOS attaches, so the zip is the same bytes wherever it
# is built.
(cd "$staging" && zip -r -q -X "$zip_path" "$NAME" -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig')

echo "built dist/$(basename "$zip_path")"
echo "  version: $version   files: $(unzip -Z1 "$zip_path" | grep -cv '/$')   size: $(du -h "$zip_path" | cut -f1)"
echo
echo "sanity check the layout (the root must be $NAME/):"
echo "  unzip -l $zip_path | head"
