#!/usr/bin/env bash
#
# What a release needs to publish a sound pack on the droplet (scripts/manager/release-job.mjs),
# as its own tree: its paths derive from its own location, and the app's copy of pipelines/ is
# what the bundle traced, not what these scripts read.
#
# Usage: deploy/web/assemble-release-tools.sh <target dir>      (from the repo root)
set -euo pipefail

TARGET=${1:?usage: assemble-release-tools.sh <target dir>}

copy=(
  scripts/manager scripts/lib scripts/audio
  pipelines/lib
  pipelines/places/tools pipelines/places/assets
  pipelines/readables/tools pipelines/readables/assets
  publishers
  addons/SpokenPlacesAudio addons/SpokenReadablesAudio addons/SpokenBossesAudio
  # The places lookup reads its zones and subzones from these.
  addons/Spoken_Places/Data
  pipelines/quests/cli-main.py pipelines/quests/tts_cli pipelines/quests/corpus pipelines/quests/assets/icon
  # What the quests build reads from outside its own folder.
  addons/Spoken_Quests/Data/Compendium.lua apps/web/src/lib/npc/character-models.json docs/quests/CHANGELOG.md
  # Brann, the Discord bot, and the FAQ he answers from. He imports scripts/lib from beside him.
  apps/brann docs/support
)

mkdir -p "$TARGET"
step=0
for path in "${copy[@]}"; do
  step=$((step + 1))
  echo "release tools: $step/${#copy[@]} $path"
  mkdir -p "$TARGET/$(dirname "$path")"
  # node_modules is a checkout's own, with links that lead out of this tree, and a clip folder
  # holds real audio on a workstation.
  if [ -d "$path" ]; then
    rsync -a --exclude node_modules --exclude Sounds --exclude __pycache__ --exclude '*.test.mjs' "$path/" "$TARGET/$path/"
  else
    cp "$path" "$TARGET/$path"
  fi
done

# pnpm's own layout, so the versions are the lockfile's. Upward resolution finds it from every
# script in the tree.
echo "release tools: dependencies"
deployed=$(mktemp -d)
pnpm --filter spoken-manager-channel deploy --legacy --prod "$deployed/out" > /dev/null
mv "$deployed/out/node_modules" "$TARGET/node_modules"
rm -rf "$deployed"

# Brann's own, beside him, so his discord.js and SDK are not the release scripts' concern.
echo "release tools: Brann's dependencies"
deployed=$(mktemp -d)
pnpm --filter @spoken/brann deploy --legacy --prod "$deployed/out" > /dev/null
mv "$deployed/out/node_modules" "$TARGET/apps/brann/node_modules"
rm -rf "$deployed"
# What never runs: types, source maps, TypeScript sources and docs. They are two thirds of his
# dependencies (the Anthropic SDK ships its sources), and every release carries them to the droplet.
find "$TARGET/apps/brann/node_modules" -type f \( -name "*.d.ts" -o -name "*.d.mts" -o -name "*.d.cts" \
  -o -name "*.map" -o -name "*.md" -o \( -name "*.ts" -path "*/src/*" \) \) -delete

# Pure Python, so this machine's version need not be the droplet's. The droplet's own package gives
# psycopg2, which is compiled against its Python.
echo "release tools: the quests build's Python dependencies"
python3 -m pip install -q --no-compile --target "$TARGET/pipelines/quests/vendor" -r pipelines/quests/requirements-release.txt

(cd "$TARGET" && node --input-type=module -e 'await import("pg"); await import("aws4fetch"); console.log("release tools: pg and aws4fetch resolve")')
(cd "$TARGET/apps/brann" && node --input-type=module -e 'await import("discord.js"); await import("@anthropic-ai/sdk"); await import("./src/support.mjs").then((s) => s.loadFaq()); console.log("release tools: Brann, his dependencies and the FAQ resolve")')
du -sh "$TARGET"
