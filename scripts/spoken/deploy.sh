#!/usr/bin/env bash
# Makes Spoken visible to a WoW client the way the CurseForge app installs it: every folder
# Spoken's zip carries (scripts/spoken/package.sh), each symlinked to its source here, so an
# edit is live after a /reload.
#
#   ./scripts/spoken/deploy.sh                    # the Forever beta
#   CLIENT=era ./scripts/spoken/deploy.sh         # era, anniversary or forever
#   ./scripts/spoken/deploy.sh --status           # what every installed client has
#
# A real folder already under one of these names (an unzipped release, say) is moved aside
# into Interface/AddOns-replaced-<time>/ beside AddOns, never deleted. The sound packs are
# separate downloads and separate folders, so they are left as they are.
#
# A real old copy under a folder name Spoken used to have (SpokenPlayer, SpokenQuests and the
# rest) is left where it is, for Spoken's leftover-folder warning to find.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WOW="/Applications/World of Warcraft"
# Every folder Spoken's zip installs. scripts/spoken/package.sh is the source of truth; keep
# this in step with its folder list.
NAMES=(Spoken SpokenContributions Spoken_Quests Spoken_Readables Spoken_Places Spoken_NPCs)

CLIENTS=(era anniversary forever)
client_flavour() { case "$1" in
  era)         echo "_classic_era_";;
  anniversary) echo "_anniversary_";;
  forever)     echo "_classic_beta_";;
esac; }
addons_dir() { echo "$WOW/$(client_flavour "$1")/Interface/AddOns"; }

if [[ "${1:-}" == "--status" ]]; then
  for client in "${CLIENTS[@]}"; do
    dir="$(addons_dir "$client")"
    [[ -d "$dir" ]] || continue
    echo "$client ($(client_flavour "$client"))"
    for name in "${NAMES[@]}"; do
      dest="$dir/$name"
      if [[ -L "$dest" ]]; then printf '  %-20s -> %s\n' "$name" "$(readlink "$dest")"
      elif [[ -d "$dest" ]]; then printf '  %-20s a copy, not a link\n' "$name"
      else printf '  %-20s not installed\n' "$name"; fi
    done
  done
  exit 0
fi

CLIENT="${CLIENT:-forever}"
[[ -n "$(client_flavour "$CLIENT")" ]] || { echo "error: unknown CLIENT \"$CLIENT\" -- use one of: ${CLIENTS[*]}" >&2; exit 1; }
ADDONS="$(addons_dir "$CLIENT")"
[[ -d "$ADDONS" ]] || { echo "error: no AddOns directory at $ADDONS" >&2; exit 1; }

replaced="$(dirname "$ADDONS")/AddOns-replaced-$(date +%Y%m%d-%H%M%S)"
for name in "${NAMES[@]}"; do
  src="$REPO/addons/$name"
  dest="$ADDONS/$name"
  [[ -d "$src" ]] || { echo "error: $src does not exist" >&2; exit 1; }
  if [[ -L "$dest" ]]; then
    rm "$dest"
  elif [[ -e "$dest" ]]; then
    mkdir -p "$replaced"
    mv "$dest" "$replaced/"
    echo "moved the copy of $name aside to $replaced/"
  fi
  ln -s "$src" "$dest"
  echo "linked $name"
done
