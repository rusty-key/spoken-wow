#!/usr/bin/env bash
# Moves a checkout's untracked data from the folders named zones and books into the ones named
# places and readables, after the folders were renamed: pipelines/, the English packs' Sounds/
# under addons/, and the language packs' build/.
#
#   scripts/migrate-section-folders.sh [checkout]     default: this one
#
# Git moves the tracked files on checkout and leaves everything it ignores behind: the take
# archives (audio-history/, which can take days to pull back from the droplet), the transcode
# cache, the wiki and wago caches, and the packs' assembled Sounds/. Run it once in every checkout
# that has them. It merges into folders that already exist, never overwrites a file, and says what
# it left behind.
# node_modules is deleted rather than moved: `pnpm install` rebuilds it at the new path.
set -euo pipefail

root=$(cd "${1:-$(dirname "$0")/..}" && pwd)
left=0

# Moves every entry of $1 into $2, descending into folders both sides have.
merge() {
  local from="$1" to="$2" entry name
  mkdir -p "$to"
  for entry in "$from"/* "$from"/.[!.]*; do
    [[ -e "$entry" || -L "$entry" ]] || continue
    name=$(basename "$entry")
    if [[ ! -e "$to/$name" && ! -L "$to/$name" ]]; then
      mv "$entry" "$to/$name"
    elif [[ -d "$entry" && ! -L "$entry" && -d "$to/$name" ]]; then
      merge "$entry" "$to/$name"
    else
      echo "  left behind: ${entry#"$root"/} (${to#"$root"/}/$name already exists)" >&2
      left=$((left + 1))
    fi
  done
  rmdir "$from" 2>/dev/null || true
}

# old:new, relative to the checkout. pipelines/ must already exist under its new name; a pack
# folder not renamed yet in this checkout is left for a later run, and build/ is made if need be.
for pair in pipelines/zones:pipelines/places pipelines/books:pipelines/readables \
    addons/SpokenZonesAudio:addons/SpokenPlacesAudio addons/SpokenBooksAudio:addons/SpokenReadablesAudio \
    build/zones:build/places build/books:build/readables; do
  from=${pair%%:*} to=${pair##*:}
  old="$root/$from" new="$root/$to"
  if [[ ! -d "$old" ]]; then
    echo "==> $from: nothing to move"
    continue
  fi
  if [[ "$from" == pipelines/* && ! -d "$new" ]]; then
    echo "$to does not exist: check out a branch with the renamed folders first" >&2
    exit 1
  fi
  if [[ "$from" == addons/* && ! -d "$new" ]]; then
    echo "==> $from: this checkout has no $to yet, left as it is"
    continue
  fi
  if [[ -d "$old/node_modules" ]]; then
    echo "==> deleting $from/node_modules"
    rm -rf "$old/node_modules"
  fi
  echo "==> $from -> $to ($(du -sh "$old" | cut -f1))"
  merge "$old" "$new"
done

if (( left > 0 )); then
  echo "$left entries left behind; nothing was overwritten" >&2
  exit 1
fi
echo "==> done; run pnpm install"
