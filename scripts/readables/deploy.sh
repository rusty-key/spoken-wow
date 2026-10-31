#!/usr/bin/env bash
# Makes addons/Spoken_Readables and addons/SpokenReadablesAudio visible to a WoW client.
#
#   ./scripts/deploy.sh          # symlink (edits are live, just /reload in-game)
#   ./scripts/deploy.sh --copy   # rsync a real copy instead
#   ./scripts/deploy.sh --status  # show what is currently installed
#   ./scripts/deploy.sh --remove  # uninstall
#
#   CLIENT=anniversary ./scripts/deploy.sh    # the 2.5.6 client instead of Era
#
# The addon ships for three clients and the only way to know it loads on all of them is to
# load it on each, so which client to install into is a variable rather than a
# constant. Installing targets one client; --status and --remove walk every client
# that is installed, because the failure they exist to catch is a stale copy left
# behind in the one you were not thinking about.
#
# Symlinking is preferred: no re-run needed after each edit. If the client's
# AddOns list does not show Spoken Writings, fall back to --copy and re-run per change.
#
# Both addons are handled together. The sound pack is optional to the player but
# not to development: symlinking it means a generation run lands in the client
# without a redeploy, exactly as an edit to a .lua does.
#
# The narration itself is NOT in the repository -- audio lives outside git -- so the pack
# folder here carries the lookup and the mp3s are whatever has been pulled into
# addons/SpokenReadablesAudio/Sounds. --status says how many that is.
#
# SavedVariables live under WTF/, not in the addon folder, so neither mode can
# destroy saved settings.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WOW="/Applications/World of Warcraft"
NAMES=(Spoken_Readables SpokenReadablesAudio)

# Client key -> the flavour directory Blizzard installs it under.
CLIENTS=(era anniversary forever)
client_flavour() { case "$1" in
  era)         echo "_classic_era_";;
  anniversary) echo "_anniversary_";;
  forever)     echo "_forever_";;
esac; }
addons_dir() { echo "$WOW/$(client_flavour "$1")/Interface/AddOns"; }

CLIENT="${CLIENT:-era}"
if [[ -z "$(client_flavour "$CLIENT")" ]]; then
  echo "error: unknown CLIENT \"$CLIENT\" -- use one of: ${CLIENTS[*]}" >&2
  exit 1
fi

mode="${1:-}"

ADDONS="$(addons_dir "$CLIENT")"

# Only installing needs the target client to exist. --status and --remove skip
# clients that are not installed rather than failing on them.
if [[ "$mode" != "--status" && "$mode" != "--remove" && ! -d "$ADDONS" ]]; then
  echo "error: $CLIENT AddOns directory not found at:" >&2
  echo "       $ADDONS" >&2
  echo "       Is that client installed to the default location?" >&2
  exit 1
fi

case "$mode" in
  --status)
    for client in "${CLIENTS[@]}"; do
      dir="$(addons_dir "$client")"
      [[ -d "$dir" ]] || continue
      echo "$client ($(client_flavour "$client"))"
      for name in "${NAMES[@]}"; do
        dest="$dir/$name"
        if [[ -L "$dest" ]]; then
          printf '  %-14s symlinked -> %s\n' "$name" "$(readlink "$dest")"
        elif [[ -d "$dest" ]]; then
          printf '  %-14s copy, %s files\n' "$name" "$(find "$dest" -type f | wc -l | tr -d ' ')"
        else
          printf '  %-14s not installed\n' "$name"
        fi
      done
    done

    # The count is the quickest answer to "why is there no narration", which is
    # otherwise indistinguishable from a broken lookup.
    sounds="$REPO/addons/SpokenReadablesAudio/Sounds"
    if [[ -d "$sounds" ]]; then
      count="$(find "$sounds" -name '*.mp3' | wc -l | tr -d ' ')"
      echo "voicelines      $count mp3 in $sounds"
    fi
    exit 0
    ;;
  --remove)
    for client in "${CLIENTS[@]}"; do
      dir="$(addons_dir "$client")"
      [[ -d "$dir" ]] || continue
      for name in "${NAMES[@]}"; do
        dest="$dir/$name"
        if [[ -L "$dest" ]]; then
          rm "$dest"
          echo "removed symlink $dest"
        elif [[ -d "$dest" ]]; then
          rm -rf "$dest"
          echo "removed directory $dest"
        else
          echo "$client/$name: nothing to remove"
        fi
      done
    done
    exit 0
    ;;
esac

for name in "${NAMES[@]}"; do
  src="$REPO/addons/$name"
  dest="$ADDONS/$name"

  if [[ ! -d "$src" ]]; then
    echo "error: $src does not exist" >&2
    exit 1
  fi

  # Refuse to clobber a real directory that this script did not create, in case
  # an unrelated copy was installed from elsewhere.
  if [[ -d "$dest" && ! -L "$dest" && "$mode" != "--copy" ]]; then
    echo "error: $dest exists as a real directory." >&2
    echo "       Re-run with --copy to overwrite it, or --remove first." >&2
    exit 1
  fi

  if [[ "$mode" == "--copy" ]]; then
    [[ -L "$dest" ]] && rm "$dest"
    mkdir -p "$dest"
    rsync -a --delete "$src/" "$dest/"
    echo "copied $src -> $dest"
  else
    [[ -L "$dest" ]] && rm "$dest"
    ln -s "$src" "$dest"
    echo "symlinked $dest -> $src"
  fi
done

if [[ "$mode" == "--copy" ]]; then
  echo "re-run this script after every edit."
else
  echo "edits are live; just /reload in-game."
fi

echo
echo "next steps in-game ($CLIENT client):"
echo "  1. enable Spoken Writings in the AddOns list at the character select screen"
echo "  2. /console scriptErrors 1     (surface Lua errors)"
echo "  3. /spw status                 (what is known, and what is narrated)"
echo "  4. open a book                 (autoplay reads it; /spw read starts it by hand)"
