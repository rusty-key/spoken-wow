#!/usr/bin/env bash
# Builds the player addon's distributable zip.
#
#   ./scripts/quests/package.sh                 # dist/Spoken_Quests-<version>.zip
#   ALLOW_DIRTY=1 ./scripts/quests/package.sh   # build from an uncommitted tree
#
# One zip serves every client: each picks its .toc by flavor suffix - _Vanilla, _TBC, else the
# unsuffixed one, which Forever reads - so the client decides.
#
# The version comes from `## Version:` in the unsuffixed .toc, so bumping the addon and naming
# the zip stay one edit. Modelled on ../wow-lore/scripts/package.sh; the difference is the
# audio living elsewhere.
#
# Addon hosts unpack the zip straight into Interface/AddOns, so its root must contain the
# Spoken_Quests/ folder itself - hence the staging copy before zipping.
#
# The sound pack is NOT here: it is 1.5 GB and rebuilt from the audio store on its own
# schedule. See scripts/quests/package-audio.sh, or `make quests-package-audio`.
#
# ADDON says where the source is read from and NAME what the installed folder is called;
# they agree now that the rename has shipped, and stay separate so scripts/spoken/package.sh
# can stage a module under its own folder name.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADDON="${ADDON:-addons/Spoken_Quests}"
NAME="${NAME:-Spoken_Quests}"
SRC="$REPO/$ADDON"
TOC="$SRC/$NAME.toc"
DIST="${DIST:-$REPO/dist}"

[ -f "$TOC" ] || { echo "error: $TOC not found" >&2; exit 1; }

version="$(sed -n 's/^## Version:[[:space:]]*//p' "$TOC" | head -1 | tr -d '\r')"
[ -n "$version" ] || { echo "error: no '## Version:' line in $TOC" >&2; exit 1; }

# A zip built from uncommitted edits cannot be traced back to a commit later.
if [ -z "${ALLOW_DIRTY:-}" ] && git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  if [ -n "$(git -C "$REPO" status --porcelain -- "$ADDON")" ]; then
    echo "error: $ADDON/ has uncommitted changes." >&2
    echo "       Commit them, or re-run with ALLOW_DIRTY=1 to package anyway." >&2
    exit 1
  fi
fi

# The client silently ignores files the .toc does not list, but a .toc listing files that do
# not exist is a typo nobody sees until the addon half-loads in game. Every variant is checked,
# not just the one this script reads the version from. A .toc separates path segments with a
# backslash, which is not a separator on this side.
for toc in "$SRC"/*.toc; do
  missing=()
  while IFS= read -r entry; do
    [ -f "$SRC/$(printf '%s' "$entry" | tr '\\' '/')" ] || missing+=("$entry")
  # A trailing load directive ("Gossip\deDE.lua [AllowLoadTextLocale deDE]") is not the path.
  done < <(sed -E -e 's/#.*//' -e 's/[[:space:]]*(\[[^]]*\])?[[:space:]]*$//' "$toc" | grep -E '\.(lua|xml)$' || true)

  # A version that drifts between variants is invisible until it ships.
  toc_version="$(sed -n 's/^## Version:[[:space:]]*//p' "$toc" | head -1 | tr -d '\r')"
  if [ "$toc_version" != "$version" ]; then
    echo "error: $(basename "$toc") says $toc_version, $NAME.toc says $version" >&2
    exit 1
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    echo "error: $(basename "$toc") lists files that do not exist:" >&2
    printf '       %s\n' "${missing[@]}" >&2
    exit 1
  fi
done

# Environment.lua carries the same version as a literal, because it loads before the addon has
# any metadata API to ask. /spq diagnostics prints it, so a stale one misreports every bug
# report filed against it.
env_version="$(sed -n 's/.*AddonVersion = "\([^"]*\)".*/\1/p' "$SRC/Environment.lua" | head -1)"
if [ "$env_version" != "$version" ]; then
  echo "error: Environment.lua says $env_version, $NAME.toc says $version" >&2
  exit 1
fi

mkdir -p "$DIST"
zip_path="$DIST/$NAME-$version.zip"
rm -f "$zip_path"

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

# The archive root has to be the installed folder name, which is not the source
# directory's name, so the zip is built from a copy laid out under it.
# -a and not -r: the addons carry no symlinks today, and copying one as a link would produce
# a zip that unpacks into nothing on someone else's machine.
mkdir -p "$staging/$NAME"
(cd "$SRC" && tar -cf - --exclude '.DS_Store' --exclude '*.bak' --exclude '*.orig' .) \
  | (cd "$staging/$NAME" && tar -xf -)

# -X drops the extra macOS attributes that otherwise ride along.
(cd "$staging" && zip -r -q -X "$zip_path" "$NAME" -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig')

files="$(unzip -Z1 "$zip_path" | grep -cv '/$')"

echo "built $(basename "$zip_path")   files: $files   size: $(du -h "$zip_path" | cut -f1)"

echo
echo "version $version, from $NAME.toc"
echo "sanity check the layout (the root must be $NAME/):"
echo "  unzip -l $DIST/$NAME-$version.zip | head"
