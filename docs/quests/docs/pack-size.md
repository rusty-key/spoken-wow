# How small the sound pack can get

Measured on 2026-08-18, against a store of 11,191 mp3s — 3.24 GB of masters, 56.2 hours of mono
speech. The pack shipped that day, `VoiceOverReduxAudio-1.0.0.zip`, was 1.5 GB. This is the
record of what was tried and what each option actually costs, so the next person deciding does
not re-run the experiment.

**What was chosen.** `make quests-package-audio` ships `ogg-q0-44k`, Ogg Vorbis at 44.1 kHz,
about 1.3 GB. The first packs built this way were Ogg Vorbis at 22.05 kHz (`ogg-q-1-22k`, 1.1.0:
**599 MB of module and a 564 MB zip** over 11,189 clips, against 1.5 GB for the mp3 pack it
replaced); that 22.05 kHz set was retired in favour of the full-band one. The rest of this file
is the evidence behind that, and the encodes that were rejected.

The sizes below are measured, and **ogg playback is confirmed**: the split packs were loaded in
Classic Era 1.15.9 on 2026-08-19 and play. That was the one open risk in the whole exercise.


## The store is no longer half inherited

`scripts/quests/package-audio.sh` and `tools/plan_transcode.py` exist because two thirds of the store
used to be the 64 kbps pack this project inherited, which `-q:a 6` cannot beat. **That is no
longer true.** Every file has since been regenerated:

| Bitrate | Files | Bytes |
| --- | --- | --- |
| 128 kbps, 44.1 kHz, mono | 11,143 | 3.23 GB |
| 64 kbps, 44.1 kHz, mono | 48 | 0.01 GB |

So the 80 kbps threshold now passes essentially the whole store through to the encoder, and the
pack grew from 1.3 GB to 1.5 GB simply because there is more of it and all of it is dense. The
gate still earns its place — it costs nothing and protects the 48 stragglers — but it is no
longer the thing holding the pack size down. The encoder settings are.


## What each encode would ship

Sample of 60 quest clips, transcoded every way and scaled to the whole store. The bitrates are
from the 16.1 s human-male clip (`audio/quests/33-accept.mp3`), which tracks the sample average
closely.

| Encode | Bitrate | Pack | Note |
| --- | --- | --- | --- |
| master, untouched | 128 kbps 44.1 kHz | 3.24 GB | what `audio/` holds |
| mp3 `-q:a 6` | 68 kbps 44.1 kHz | 1.66 GB | what shipped on 2026-08-18 |
| ogg `-q 0` | 49 kbps 44.1 kHz | 1.26 GB | full band, parity with the old 64 kbps pack |
| mp3 `-q:a 8` at 22.05 kHz | 35 kbps 22.05 kHz | 0.93 GB | no format change to make |
| mp3 `-b:a 32k` at 22.05 kHz | 32 kbps 22.05 kHz | 0.82 GB | CBR, worse than the VBR above it |
| ogg `-q 0` at 22.05 kHz | 28 kbps 22.05 kHz | 0.75 GB | |
| ogg `-q -1` at 22.05 kHz | 23 kbps 22.05 kHz | 0.61 GB | smallest tried |

Two independent levers are stacked in that table, and they are worth separating before judging a
row:

- **The codec.** Vorbis buys roughly 1.3–1.5× over LAME at these rates, so ogg at 49 kbps is
  about where mp3 sits at 68 kbps. This lever is free: it costs nothing but the plumbing.
- **The sample rate.** Dropping to 22.05 kHz halves the size again but puts a hard ceiling at
  11 kHz. Speech survives it; sibilance is where it shows, so a female voice is the honest test.
  Comparing ogg 44.1 kHz against ogg 22.05 kHz is judging this lever alone.

Samples for an A/B — five voices, every encode above, named `0` (master) through `6` (smallest)
— are reproduced by the commands at the end of this file.


## And then it shipped in four pieces

Encoding was not the end of it: CurseForge answered the 564 MB upload with a Cloudflare `413`
before the API saw it, so the audio now ships as four addons — Alliance, Horde, Shared Quests
and Gossip — which partition it exactly, and a player installing their side plus Shared lands
near half of what the whole thing costs. A meta addon, a fifth CurseForge project, carries a few
kilobytes declaring the four as dependencies, since one folder holding everything cannot be
uploaded to CurseForge at all.

That makes the size question two questions. This file is about how many bytes a *line* costs,
and the split is about how many lines a *player* needs; both were worth doing, and the second
does not retire the first. README's *The pack ships in four pieces* has the mechanics, and
`tools/export_factions.py` has the derivation of which side a quest is on.


## What was ruled out

- **Deduplication.** Zero. All 11,191 files are byte-distinct; the ~1,076 clips shared between
  NPCs are shared by *filename*, and the store already holds one copy of each.
- **Trimming silence.** 0.04% of total duration at a -50 dB threshold. ElevenLabs does not leave
  padding worth cutting.
- **Compressing the zip harder.** mp3 and ogg are already entropy-coded; the zip is a container.
  Pack size is audio size.

That leaves the encode settings as the only lever, which is why the table above is the whole
decision.


## How the two profiles are built

`ENCODE` names a profile in `scripts/quests/package-audio.sh`, and a profile is a format plus the flags
that produce it and nothing else:

| Profile | Encoder flags | Built by |
| --- | --- | --- |
| `ogg-q-1-22k` | `oggenc -q -1 --resample 22050` | `ENCODE=ogg-q-1-22k`, retired |
| `ogg-q0-44k` | `oggenc -q 0` | `make quests-package-audio`, the default |
| `vbr-v6` | `ffmpeg -codec:a libmp3lame -q:a 6` | what shipped before this |
| `copy` | none — the masters | `ENCODE=copy make quests-package-audio` |

Four things follow from a pack being able to hold something other than mp3:

- **A pack ships one format.** `GetSoundPath` writes a single extension for every sound, so a
  store holding both would resolve half a module's lines to files that are not there.
  `tts_cli/store.py:audio_extension` refuses such a store, and `tts_cli/build.py` writes the
  extension the staged store implies rather than a constant.
- **The bitrate gate is now half a decision.** `tools/plan_transcode.py:plan_action` compares
  formats first: a clip whose format already matches the target falls through to the 80 kbps
  threshold, and anything else is encoded whatever its bitrate.
- **The master-is-smaller fallback only applies to mp3.** Keeping a master because its encode
  came out larger would strand that line on a path the module does not write, so an ogg pack
  ships the larger file.
- **The cache is per profile.** `audio-transcoded/<profile>/<md5 of master>.<ext>`, so the two
  profiles cannot read each other's entries and neither can read `vbr-v6`'s.

Encoding is `oggenc` from `vorbis-tools`, not ffmpeg: Homebrew's ffmpeg is built without
`libvorbis`, and ffmpeg's own Vorbis encoder is experimental and worse at every rate. ffmpeg
still decodes. Both are checked before a run starts.

The store stays mp3 throughout. `audio/` holds the masters and is never transcoded in place, so
raising the shipped quality later is a re-run of `make quests-package-audio` rather than another
purchase from ElevenLabs — which is also why the old `audio-transcoded/vbr-v6/` cache can be
deleted whenever the disk is wanted.


## Reproducing the samples

```bash
brew install vorbis-tools
src=audio/quests/151-accept.mp3      # Verna Furlbrow, human female, 23.6 s
ffmpeg -i "$src" -ac 1 /tmp/s.wav

ffmpeg -i "$src" -codec:a libmp3lame -q:a 6 -ac 1              /tmp/1-mp3-q6-44k.mp3
ffmpeg -i "$src" -codec:a libmp3lame -q:a 8 -ar 22050 -ac 1    /tmp/2-mp3-q8-22k.mp3
ffmpeg -i "$src" -codec:a libmp3lame -b:a 32k -ar 22050 -ac 1  /tmp/3-mp3-32k-22k.mp3
oggenc -q 0                    -o /tmp/4-ogg-q0-44k.ogg  /tmp/s.wav
oggenc -q 0  --resample 22050  -o /tmp/5-ogg-q0-22k.ogg  /tmp/s.wav
oggenc -q -1 --resample 22050  -o /tmp/6-ogg-qm1-22k.ogg /tmp/s.wav
```
