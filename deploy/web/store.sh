#!/usr/bin/env bash
#
# Move the audio stores onto the /mnt/voice volume. Run ON THE DROPLET, as root.
#
#   sudo bash deploy/web/store.sh
#
# Idempotent: run it again after adding a directory, or to check the layout is still what
# it should be.
#
# WHY A SEPARATE DISK. The droplet's root filesystem is 33 GB and the two old sites already
# hold ~10 GB of audio between them, which the merge copies rather than moves -- the old
# trees are the rollback. Doing that on root leaves ~2 GB of headroom for releases, logs and
# a database, which is not enough to be relaxed about. /mnt/voice is a 30 GB block volume
# that can be grown without touching the droplet.
#
# WHY SYMLINKS RATHER THAN MOVING THE PATHS. /srv/spoken/shared/<store> is the name
# everything already uses: ecosystem.config.js builds every SPOKEN_*_AUDIO variable from it,
# make/quests.mk and make/places.mk rsync into it, nginx aliases /downloads/ at it, and the
# cutover copies into it. Pointing that name at the volume changes where the bytes live and
# nothing else, so there is one path to reason about instead of two.
#
# WHAT STAYS ON ROOT. app.env and ecosystem.config.js, which are configuration rather than
# data. And manifest.json, which is not on the volume for a specific reason: it is written
# with write-temp-then-rename, and renaming over a symlink REPLACES THE SYMLINK with a real
# file. It is 384 KB and the `take` table can rebuild it, so it stays where the rename is
# harmless.
set -euo pipefail

VOLUME=${VOLUME:-/mnt/voice}
STORE=$VOLUME/spoken
SHARED=${SHARED:-/srv/spoken/shared}

# Everything that is bytes on disk rather than configuration. Only the top level is
# linked: audio-history/quests is reached THROUGH the audio-history link, and linking it
# separately would point it at itself.
LINKS=(audio sounds books audio-history voices audio-previews downloads)
CHILDREN=(audio-history/quests audio-history/places audio-history/readables audio-history/bosses)

# The volume has to be mounted BEFORE anything is created under it. /etc/fstab mounts it
# `nofail`, so a droplet that boots without it boots fine and /mnt/voice is an ordinary
# empty directory on root -- and creating the tree there would quietly fill the disk this
# exists to protect.
mountpoint -q "$VOLUME" || {
  echo "store: $VOLUME is not a mount point. Mount the volume first: mount $VOLUME" >&2
  exit 1
}

echo "==> $STORE"
install -d -o deploy -g deploy -m 755 "$STORE"
for dir in "${LINKS[@]}" "${CHILDREN[@]}"; do
  install -d -o deploy -g deploy -m 755 "$STORE/$dir"
done

# The mounted-volume marker, and the whole point of it: it lives ON the volume, so it is
# there when the volume is and gone when it is not. bin/activate.sh refuses to deploy
# without it, which turns "the volume did not come back after a reboot" from an app that
# serves 404s for every line into a deploy that stops and says so.
install -o deploy -g deploy -m 644 /dev/null "$STORE/.store"

echo "==> $SHARED"
for dir in "${LINKS[@]}"; do
  path=$SHARED/$dir
  target=$STORE/$dir

  # Already pointed at the volume: nothing to do, and say so rather than silently passing,
  # because a wrong target is exactly what a re-run is meant to catch.
  if [ -L "$path" ]; then
    current=$(readlink "$path")
    [ "$current" = "$target" ] || {
      echo "store: $path points at $current, not $target. Fix it by hand." >&2
      exit 1
    }
    echo "    $dir -> (already linked)"
    continue
  fi

  # A real directory holding FILES is somebody's audio. Moving ~10 GB is not something to
  # do inside a setup script that can be interrupted; this stops and hands it back.
  #
  # Empty subdirectories do not count: bootstrap.sh creates audio-history/{quests,places},
  # and refusing over the skeleton this script is meant to replace would mean it could
  # never run on a droplet that had been bootstrapped.
  if [ -d "$path" ] && [ -n "$(find "$path" -mindepth 1 ! -type d -print -quit)" ]; then
    echo "store: $path has contents. Move them first:" >&2
    echo "    rsync -a --remove-source-files $path/ $target/ && find $path -type d -empty -delete" >&2
    exit 1
  fi

  rm -rf "$path"
  ln -s "$target" "$path"
  chown -h deploy:deploy "$path"
  echo "    $dir -> $target"
done

echo
df -h "$VOLUME" | tail -1
echo "==> done. The stores are on the volume; app.env, ecosystem.config.js and"
echo "    manifest.json stay on root."
