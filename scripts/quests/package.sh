#!/usr/bin/env bash
# Builds the player addon's distributable zips.
#
#   ./scripts/quests/package.sh                 # dist/Spoken_Quests-<version>.zip + one per legacy client
#   ALLOW_DIRTY=1 ./scripts/quests/package.sh   # build from an uncommitted tree
#
# ONE ZIP FOR BLIZZARD'S CLIENTS, ONE APIECE FOR THE LEGACY ONES. Blizzard's clients
# pick their .toc by flavor suffix - _Vanilla, _TBC, _Wrath, _Mainline - so a single archive
# serves Classic Era through retail and the client decides. The 1.12, 2.4.3 and 3.3.5 clients
# predate suffix support: each reads Spoken_Quests.toc and nothing else, and each wants a
# different file under that one name, so each needs an archive of its own. They also load a
# vendored Ace3 of their own - the root Libs/ binds C_Timer.After at load time - which is why
# every legacy zip carries its client's directory and none of the others.
#
# The version comes from `## Version:` in the unsuffixed .toc, so bumping the addon and naming
# every zip stay one edit rather than five. Modelled on ../wow-lore/scripts/package.sh; the
# differences are the legacy clients and the audio living elsewhere.
#
# Addon hosts unpack the zip straight into Interface/AddOns, so its root must contain the
# Spoken_Quests/ folder itself - hence the staging copy before zipping.
#
# THE LEGACY ZIPS ALSO CARRY THE SPOKEN PLAYER. Those clients have no addon manager to
# install a dependency, so the player travels inside the zip, staged from its own tree at
# build time -- there is no committed second copy that could drift, and the build asserts
# the staged copy is byte-identical to addons/Spoken/ apart from the per-client pruning and
# the .toc swap. Since it is guaranteed present, the dependency is hard there where it is
# soft everywhere else.
#
# The sound pack is NOT here: it is 1.5 GB and rebuilt from the audio store on its own
# schedule. See scripts/quests/package-audio.sh, or `make quests-package-audio`.
#
# ADDON says where the source is read from and NAME what the installed folder is called;
# they agree now that the rename has shipped, and stay separate because the staging copy
# is what lets the zips be assembled from more than one tree.
#
# THE LEGACY ZIPS ALSO CARRY TWO TOMBSTONES. The folder was SpokenQuests until 3.0.0-beta.3
# (addons/SpokenQuests/SpokenQuests.toc says why it moved), and Spoken was SpokenPlayer before
# 3.0.0. Unzipping over an older install adds the new folders without removing the old ones, so
# each old folder gets a .toc that never loads under the one name this client reads from it.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADDON="${ADDON:-addons/Spoken_Quests}"
NAME="${NAME:-Spoken_Quests}"
SRC="$REPO/$ADDON"
PLAYER_SRC="$REPO/addons/Spoken"
PLAYER="Spoken"
# The tombstones the legacy zips carry beside the module and the player they bundle: the old
# player's folder, and this module's own before the rename.
TOMBSTONE="SpokenPlayer"
OLD_NAME="SpokenQuests"
# shellcheck source=../lib/tombstone.sh
source "$REPO/scripts/lib/tombstone.sh"
TOC="$SRC/$NAME.toc"
DIST="${DIST:-$REPO/dist}"

# client label -> the .toc variant it loads, which is also the directory holding that client's
# vendored Ace3. The label lands in the zip name, where it is what a player picks between.
CLIENTS=(
  "1.12:1.12"
  "2.4.3:2.4.3"
  "3.3.5:3.3.5"
)

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
# not just the one this script reads the version from: the legacy ones point at directories no
# other client loads, so nothing else would ever notice them going missing. A .toc separates
# path segments with a backslash, which is not a separator on this side.
for toc in "$SRC"/*.toc; do
  missing=()
  while IFS= read -r entry; do
    [ -f "$SRC/$(printf '%s' "$entry" | tr '\\' '/')" ] || missing+=("$entry")
  # A trailing load directive ("Gossip\deDE.lua [AllowLoadTextLocale deDE]") is not the path.
  done < <(sed -E -e 's/#.*//' -e 's/[[:space:]]*(\[[^]]*\])?[[:space:]]*$//' "$toc" | grep -E '\.(lua|xml)$' || true)

  # A version that drifts between variants is invisible until it ships, and it did drift: the
  # legacy TOCs still said 1.0.0 when the rest said 1.1.1.
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
# directory's name, so every zip is built from a copy laid out under it.
stage_tree() { # <staging dir> <source dir> <installed folder name>
  local dest="$1/$3"
  mkdir -p "$dest"
  # -a and not -r: the addons carry no symlinks today, and copying one as a link would
  # produce a zip that unpacks into nothing on someone else's machine.
  (cd "$2" && tar -cf - --exclude '.DS_Store' --exclude '*.bak' --exclude '*.orig' .) \
    | (cd "$dest" && tar -xf -)
}
stage_addon() { stage_tree "$1" "$SRC" "$NAME"; }

# A legacy zip carries one client's tree only: the variant .toc takes the unsuffixed name and
# everything the other clients need is removed.
prune_for_client() { # <staged folder> <addon name> <source dir> <client variant>
  local folder="$1" name="$2" src="$3" variant="$4" other
  local source_toc="$src/${name}_${variant}.toc"
  [ -f "$source_toc" ] || { echo "error: no $source_toc" >&2; exit 1; }
  cp "$source_toc" "$folder/$name.toc"
  rm -rf "$folder/Libs" "$folder/embeds.xml"
  rm -f "$folder"/${name}_*.toc
  for other in "${CLIENTS[@]}"; do
    [ "${other##*:}" = "$variant" ] || rm -rf "$folder/${other##*:}"
  done
}

# Addon hosts unpack into Interface/AddOns, so the archive root must be the folder itself.
# -X drops the extra macOS attributes that otherwise ride along. The legacy client directories
# are excluded: a Blizzard client loads none of them, and they are most of the archive.
legacy_excludes=()
for pair in "${CLIENTS[@]}"; do
  legacy_excludes+=("$NAME/${pair##*:}/*" "$NAME/${NAME}_${pair%%:*}.toc")
done

stage_addon "$staging/blizzard"
(cd "$staging/blizzard" && zip -r -q -X "$zip_path" "$NAME" \
  -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig' "${legacy_excludes[@]}")

files="$(unzip -Z1 "$zip_path" | grep -cv '/$')"

echo "built $(basename "$zip_path")   files: $files   size: $(du -h "$zip_path" | cut -f1)"

for pair in "${CLIENTS[@]}"; do
  client="${pair%%:*}"
  variant="${pair##*:}"
  # The unsuffixed name is the only one this client opens, so the variant for it goes there.
  # Everything the other clients need is then dead weight: the suffixed .toc files, the root
  # Libs/ (its AceTimer binds C_Timer.After, which does not exist here), and the two other
  # vendored trees. The legacy variant TOC is where the player becomes a hard dependency.
  stage_addon "$staging/$client"
  prune_for_client "$staging/$client/$NAME" "$NAME" "$SRC" "$variant"
  grep -q '^## Dependencies: Spoken$' "$staging/$client/$NAME/$NAME.toc" || {
    echo "error: ${NAME}_${variant}.toc must declare '## Dependencies: Spoken'" >&2; exit 1; }

  # The player, pruned the same way. It is copied from addons/Spoken on every build; the
  # packaging tests assert the zip's copy is byte-identical to that tree.
  stage_tree "$staging/$client" "$PLAYER_SRC" "$PLAYER"
  prune_for_client "$staging/$client/$PLAYER" "$PLAYER" "$PLAYER_SRC" "$variant"
  # And the tombstones, over the one .toc this client reads from each old folder.
  mkdir -p "$staging/$client/$TOMBSTONE" "$staging/$client/$OLD_NAME"
  tombstone_toc "$REPO/addons/$TOMBSTONE/$TOMBSTONE.toc" "$PLAYER_SRC/${PLAYER}_$variant.toc" \
    "$staging/$client/$TOMBSTONE/$TOMBSTONE.toc"
  tombstone_toc "$REPO/addons/$OLD_NAME/$OLD_NAME.toc" "$SRC/${NAME}_$variant.toc" \
    "$staging/$client/$OLD_NAME/$OLD_NAME.toc"

  zip_path="$DIST/$NAME-WoW_$client-$version.zip"
  rm -f "$zip_path"
  (cd "$staging/$client" && zip -r -q -X "$zip_path" "$NAME" "$PLAYER" "$TOMBSTONE" "$OLD_NAME" \
    -x '*.DS_Store' '*/.git/*' '*.bak' '*.orig')

  files="$(unzip -Z1 "$zip_path" | grep -cv '/$')"
  echo "built $(basename "$zip_path")   files: $files   size: $(du -h "$zip_path" | cut -f1)"
done

echo
echo "version $version, from $NAME.toc"
echo "sanity check the layout (the root must be $NAME/):"
echo "  unzip -l $DIST/$NAME-$version.zip | head"
