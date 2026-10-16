# Spoken Combat

Spoken Combat is a separate module bundled with Spoken. Open Options → AddOns →
Spoken → Combat. Enable Module controls combat speech for your Spoken profile and is on
by default. Speak in Parties and Speak in Dungeons are on by default; Speak in Raids is
off. These three context preferences are saved per character. Solo combat outside instances
is allowed.
Raid groups and raid instances use the raid setting first, dungeons use the dungeon setting
even when solo, and ordinary parties outside dungeons use the party setting. There is no
separate battleground or arena option. These settings filter combat entry, not group entry.
Preview Combat Voice works while the module is enabled, regardless of context preferences.
Combat automatically selects an installed English voice set matching the character’s race
and sex. All eight Classic Era races have male and female catalogue entries, using stable
`-player` identifiers such as `dwarf-female-player`. Missing matches stay silent, including
during preview; there is no fallback to another race or sex. The settings page reports the
matching voice and whether its recordings are installed. Eight short lines play in a shuffled order on
entering combat, with at least 45 seconds between successful combat reactions. Reshuffling
does not repeat the last line. Skipped triggers are discarded, never queued.

A valid manifest identifies an installed voice set; its files are checked when played.
If WoW rejects a file, Combat skips it for the rest of the session and tries another clip
on the same combat entry or preview. Healthy clips continue to play. Settings report the
failure, and a preview reports newly skipped files even if another clip succeeds. If all
clips fail, combat stays silent and preview is unavailable. Reinstall the audio pack and
restart WoW to retry the repaired files. Muted sound, narration and unsupported clients
do not mark files as broken. Only successful combat playback spends the cooldown.

Combat speech has no narrator, queue entry, subtitle, transcript or portrait. It uses
Spoken's selected audio channel and skips while narration is speaking. Narration that starts
during a reaction stops it. Leaving combat lets it finish; disabling the feature, dying or
using `/spoken stop` stops it. Preview requires Enable Module and ignores the combat cooldown, but
still respects narration, sound settings and a reaction already playing. It also ignores
the party, dungeon and raid restrictions.

Legacy 1.12, 2.4.3 and 3.3.5 clients are excluded: their playback can stop other sounds or
take over the music channel. This feature needs independent stoppable playback.

## Approved catalogue and voice

The catalogue is `apps/web/src/lib/combat/lines.json`. It defines 16 voice identities and
eight recording keys per set. Only `nightelf-female-player` currently has dialogue, beginning
with "So much for a peaceful walk." The other entries have no dialogue or recordings yet.
Do not reuse night elf dialogue for them. The approved narration uses dry, conversational delivery.

`addons/Spoken_Combat/Voices.lua` is generated from that catalogue. After changing identities
or recording keys, run `python scripts/spoken/combat_catalogue.py`. Packaging tests check
that the two agree. Matching uses the non-localized race token from `UnitRace` and the sex
from `UnitSex` (2 male, 3 female); Undead uses the race token `Scourge`.

The approved baseline is take 3 of that line: Chatterbox Nano, temperature `0.5`, top-p
`0.9`, repetition penalty `1.2`, and seed `73`. The voice reference combines native English
female night elf player greetings, thanks and farewells. Match output RMS to
`0.12552565336227417`, with a peak limit of `0.94`. All eight selected recordings have listening
approval. Record the seed and any pronunciation respelling with each future take. Line 02 is
approved with the spoken spelling `e-loon` and seed `77`; the displayed text stays
"Elune, a little backup?".

The pinned model, settings and reference hashes are in `combat-voice-recipe.json`.
The selected recordings, reference, native source clips, take metadata, listening preview
and offline reproduction helper are kept locally under
`pipelines/quests/audio-previews/combat-voice/`. All eight selected recordings have listening approval. These files are gitignored and need a separate backup. Generate previews outside the shipped pipelines,
then package supplied recordings below. Never write local previews into the take archive.

## Produce the recordings

Deploy the site changes before using the new page. Sign in with English regeneration
permission and open `/enUS/combat`, also linked from the English Voices page. Select the
provider and settings on Voices and ensure `nightelf-female-player` exists there.
Each Generate or Regenerate click uses the signed-in person's saved provider key and spends
credits. No CLI or addon generates speech.

Generate and audition lines 01, 02 and 03 first. Finish the set after checking that the voice
sounds like the character and each delivery is brief. The target is 1–3 seconds; recordings
longer than 6 seconds cannot be packaged. The download includes each complete voice set
with all eight current recordings and omits incomplete or undefined sets. It needs at least one complete set.

The catalogue is `apps/web/src/lib/combat/lines.json`. Its keys and derived paths are frozen:
`c:nightelf-female-player:01` through `:08`, with archive files
`combat/nightelf-female-player-01.mp3` through `-08.mp3`. These takes use source `quests`
in the shared take table and the quests `audio-history/combat/` directory, so existing
quests history backups keep them. They are not NPC corpus rows and do not enter quest packs.
The page exports the selected immutable take versions directly from the production archive.

The download is a standalone `SpokenCombatAudio-<version>.zip`, installed beside Spoken.
It contains `SpokenCombatAudio/SpokenCombatAudio.toc`, a self-registering `Data/Sounds.lua`
manifest and eight files per included voice set under `SpokenCombatAudio/Sounds/Combat/`. It never overwrites
Spoken or Spoken Combat. The main Spoken download carries the Combat module without voices.

The sound pack registers in `SpokenCombatAudioPacks`. Spoken Combat discovers compatible
sets and resolves their clips from the pack's own folder. Each set registers under
`addon .. ":" .. voice`, so several sets can coexist in one audio addon. Missing or incompatible packs
leave the module silent and show installation guidance. The source pack has an empty
manifest; only a recording-package build contains playable audio.

Combat settings show the addon folder supplying the character's voice. If several addons
supply that same voice, a warning explains that the first addon folder alphabetically wins.
Disable extra packs to choose the supplier. Playback failures do not switch suppliers;
this avoids unexpectedly changing the character's voice. Other race or sex sets do not
count as duplicates.

The pack version is independent of Spoken. `apps/web/src/lib/combat/audio-pack.json`
and `addons/SpokenCombatAudio/SpokenCombatAudio.toc` carry its release metadata; packaging
tests require them to agree. Audio pack notes live in `docs/combat/CHANGELOG.md`.

## Test in game

For an independent test using your own recordings, place the eight clips in a folder,
named `01.wav` through `08.wav` in the catalogue's order. MP3 and OGG Vorbis are also accepted;
use one file per number, with a maximum duration of 6 seconds. PCM WAV must be 16-bit mono
or stereo. These files stay yours and are copied into a package, never into the take archive.

```sh
python scripts/spoken/package-combat-recordings.py /path/to/recordings --voice dwarf-female-player
```

This writes `dist/SpokenCombatAudio-0.0.1.zip`. WAV input needs only Python;
MP3 and OGG need `ffprobe` on PATH or supplied through `--ffprobe`. This command packages
existing files and makes no speech requests. No site account or provider credentials are
needed. Keep the original recordings outside git. The addon uses the supplied audio as-is;
the supplied voice id must match the intended character. A flat folder without `--voice`
defaults to `nightelf-female-player`.

To package multiple sets together, give the script a parent folder containing one subfolder
per voice id. Each included subfolder must contain all eight recordings:

```text
recordings/
  dwarf-female-player/01.wav ... 08.wav
  nightelf-female-player/01.wav ... 08.wav
```

```sh
python scripts/spoken/package-combat-recordings.py /path/to/recordings
```

Missing voice sets need no subfolder. Local packaging works before dialogue is defined on
the site, so new recordings can be auditioned independently. It replaces the installed
pack manifest, so include every voice set you want to keep available in the new package.
The packaging command lists the included voice ids and recording counts after a successful
build and explains the replacement behavior. The website lists the included sets before
the download button and warns that omitted sets will no longer be available from that addon.
Existing development packs using `nightelf-female-standard` must be rebuilt from their
original numbered recordings. Original recordings and take archives are never renamed or deleted.
The site needs a provider voice or reference named `nightelf-female-player`; existing
`-standard` NPC voices remain separate. Archived takes under the old combat identifier
are retained, but are not selected as recordings for the renamed set.

1. Install a build of Spoken that includes Combat Voice. Close WoW and extract the recording
   zip into `Interface/AddOns`, creating the separate `SpokenCombatAudio` folder beside `Spoken` and `Spoken_Combat`.
2. Start WoW and log in on a character matching an included set. Open Options → AddOns →
   Spoken → Combat, enable the module and click Preview Combat Voice.
   `/spoken combat test` also previews while the module is enabled and bypasses the cooldown.
   `/spoken combat on` and `/spoken combat off` change Enable Module for the current profile.
3. Check that Enable Module, Speak in Parties and Speak in Dungeons start enabled,
   and Speak in Raids starts disabled.
4. Fight an enemy. One short line should play without showing any narrator UI. Leave combat
   and re-enter within 45 seconds: no second reaction. Re-enter after 45 seconds: another
   line. Preview repeatedly to audition all eight and check variety.
5. Start a quest or zone reading, then enter combat: only narration should speak. Start a
   reading during a reaction: narration takes precedence and stops the reaction.
6. Try several narrator styles, including Sound Only. Log in on characters matching each
   included set and check that each uses its own recordings. Try another race or sex with
   no supplied set: combat and preview stay silent, and settings name the missing voice.
7. Disable Combat Voice while a line is speaking to stop it immediately. Reload and verify
   that the profile module switch persists and also blocks preview while disabled.
8. Join an ordinary party outdoors and enter combat, then disable Speak in Parties and
   repeat after the cooldown: only the enabled setting permits speech. Enter a dungeon
   and repeat with Speak in Dungeons; the party setting must not override it. A solo
   dungeon uses the dungeon setting too.
9. Convert a group to a raid outdoors, then try a raid instance. Both stay silent with
   Speak in Raids off and permit speech with it on, subject to the usual cooldown and
   narration rules. Preview still works in a restricted context. Reload and check that
   all three context preferences persist.

Spoken updates do not replace the sound pack. Update the sound pack by extracting its
new zip over the existing `SpokenCombatAudio` folder with WoW closed. Existing development
recording zips that overlay `Spoken` or `Spoken_Combat` must be repackaged from their eight
original recordings; they are not standalone sound packs. Keep those originals and backups.

The store does not yet have a Spoken Combat Audio project. Publishing the separate pack
and adding its dependency to any desired Everything bundles are release work.
