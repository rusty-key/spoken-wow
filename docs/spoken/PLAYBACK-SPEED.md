# Optional playback speeds

`PlaySoundFile` cannot change a recording's rate. Spoken therefore uses separate audio copies for
1.5× and 2×. The original voice pack stays installed and 1× remains the default. A missing faster
copy plays at 1×. Changing the setting during a line restarts that line from the beginning, since
the client cannot seek into a sound file.

Each optional addon mirrors the OGG and MP3 paths inside one original voice pack. For example,
`SpokenQuestsAudio_esES` gets `SpokenSpeed15_SpokenQuestsAudio_esES` for 1.5×. The same builder
accepts an English release ZIP with several addon folders and makes a separate optional folder
for each. It works for any language and any Spoken module whose audio is in a ZIP.

Build a variant from an official audio ZIP with FFmpeg built with `libvorbis` and `libmp3lame`:

```sh
python scripts/audio/optional-speed-pack.py ORIGINAL.zip --speed 1.5 --output OPTIONAL-1.5.zip
python scripts/audio/optional-speed-pack.py ORIGINAL.zip --speed 2 --output OPTIONAL-2.zip
```

Run the commands for the English and Spanish ZIPs you want to support. The tool reads the
originals and writes audio-only add-ons; it does not call a TTS service or alter the source ZIP.
The optional ZIPs can be offered separately, so a 1× listener downloads no extra audio. Extract
the original pack and the chosen optional pack into `Interface/AddOns`, then restart WoW so it
can see the new sound files. Select Voice Speed in Spoken's settings or cycle the rate on the
narrator window. The numbers and caption word timings follow the copy actually played.

Build both rates from every source pack a player might hear if every line must stay at one rate.
Otherwise the missing lines play at 1×. A speed pack's files are transcoded from shipped audio,
not from masters, so listen to sample lines before publishing it. These optional audio
downloads are much larger than the code change and need their own releases.
