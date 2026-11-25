# Speed packs

A speed pack is a copy of a Spoken voice pack whose voice plays faster or slower, shared as a
[community pack](../../community/README.md). Spoken itself plays every pack at the speed it was
recorded. A player who wants another speed installs a speed pack beside the original and puts its
voice first under **Voices, in Order** in Spoken's settings. The voice is named after the speed,
"English · 1.5x". Any line the speed pack lacks plays from the original at its own speed.

`scripts/community/speed-pack.py` builds one and publishes it. It changes three things in a copy of
the pack: every clip is re-timed with ffmpeg, every length and word time in the pack's Lua is
divided by the speed so the captions follow the voice, and the folder becomes
`SpokenCommunity_<id>` with a `.toc` that names the new voice. The original pack is not changed.

## What you need

- Python 3.9 or newer.
- ffmpeg. For packs in Ogg, ffmpeg built with libvorbis, or `oggenc` beside it (macOS:
  `brew install ffmpeg vorbis-tools`; Debian and Ubuntu: `apt install ffmpeg vorbis-tools`; Windows:
  ffmpeg from ffmpeg.org, which has libvorbis).
- To publish: the GitHub CLI `gh`, signed in (`gh auth login`), and an account on
  [spoken.quest](https://spoken.quest).
- The packs you want copied, installed in your AddOns folder or as their release zips.

## Set up once

```sh
python3 scripts/community/speed-pack.py setup
```

It asks for your AddOns folder, a public GitHub repository for the zips (and creates it), a prefix
for your pack ids, the author name shown on your packs, and a spoken.quest token. Make the token on
your spoken.quest profile with the **Community packs** option. The answers are kept in
`~/.config/spoken/speed-pack.json` (on Windows, `%APPDATA%\spoken\speed-pack.json`), readable only
by you. `SPOKEN_TOKEN` in the environment overrides the saved token.

## Build and publish

```sh
python3 scripts/community/speed-pack.py SpokenQuestsAudioAlliance_enUS SpokenQuestsAudioShared_enUS --speed 1.5
```

Name each pack by its folder in your AddOns folder, or give a path to a pack folder or a release zip;
a zip with several packs gives one speed pack for each. `--speed` takes 0.5 to 4: above 1 is faster,
below 1 slower, with at most two decimals.

For each pack, the script:

1. Re-times every clip. Clips it has made before come from its cache, so a rebuild after a pack
   update only encodes the lines that are new or changed.
2. Writes `speed-packs/SpokenCommunity_<id>.zip`. Its id is your prefix, the pack and the speed,
   such as `poltiger-quests-alliance-enus-x150`; `--id` sets another for a single pack.
3. Uploads the zip as an asset of a new release, `<id>-v<version>`, in your repository.
4. Sends it to spoken.quest for review: a new pack the first time, a new version after that. You
   get an email when an admin decides, and players see it in the Spoken Manager once approved.

The version is the original pack's. Rebuilding the same original adds a step, `2.5.0.1`, so the
Manager still offers it as an update. A rebuild that comes out identical to the live version is not
uploaded. A pack with a version still waiting for review is skipped until that one is decided or
withdrawn on [My packs](https://spoken.quest/packs).

`--build-only` builds the zips and stops, for trying a speed in game before publishing it: unzip
the folder into `Interface/AddOns` and restart the game.

## Keep it up to date

When the original pack has a new release, update it and run the same command. Until you do, lines
the new release added play from the original at its own speed.

## The cache

Clips are cached under `~/.cache/spoken/speed-packs/<pack id>/<speed>/` (on Windows,
`%LOCALAPPDATA%\spoken\speed-packs\`), each named by the checksum of the clip it was made from.
Each build drops the clips the pack no longer has. `--cache` puts the cache elsewhere. Deleting it
only costs the time to encode again.

## Limits

- One community pack is one folder, so each original pack becomes its own speed pack: the four
  English quest packs at one speed are four speed packs.
- Bosses packs can be built with `--build-only`, but the Spoken Manager does not list bosses
  community packs yet.
- A speed pack is re-encoded from the shipped clips, not from the recordings they were made from, so
  listen to a few lines before publishing it.
