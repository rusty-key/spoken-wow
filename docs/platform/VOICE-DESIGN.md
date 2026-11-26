# Designing an original voice for Spoken

The goal is a voice that suits a WoW character type without copying anyone's real voice. Game
recordings are only inspiration. ElevenLabs never receives them, only a written description.

**Game clips are for comparison and inspiration only.** Never clone one, remix one, or upload one to
ElevenLabs (Voice Clone, Voice Remix or design-from-audio). The page says so wherever a game clip
appears; the only places they go are Gemini's blind comparison and openSMILE.

All of it happens on `/voices/design` (Backstage, "Design new voices" on `/voices`). Anyone with
`configure` in a language may design and review its slots; anyone who may see `/voices` may listen.
Every version belongs to the team, so the whole team sees, reviews and builds on it.

## Before you start

- Add your **ElevenLabs** key on your profile. Designing, saving and sampling spend from it.
- Add a **Gemini** key on your profile (Google AI Studio, API keys) to use the blind comparison.
  It costs a few cents a run.
- The comparison listens to each slot's game clip: its fish.audio reference window, else the first
  30 seconds of its first stored clip on `/voices`. A slot with neither is left out.

## 1. Compare the flavors blind

Slots are grouped by race, then gender. Open a group and press **Compare blind**.

- Every flavor of the race-gender goes to Gemini together, labeled A, B, C in a random order. It is
  never told the flavor names: told "shady", the model hears shady.
- It is told who uses each flavor (the busiest NPCs of each slot), because the voice has to suit
  those characters, not the flavor's name. For orc males, `guard` turned out to be grunts and
  soldiers, `standard` innkeepers and traders, and `shady` warlocks and rogues.
- When the site has openSMILE (below), each clip's measurements go with it, and the page shows them.
  Use the differences between flavors, not the absolute numbers: game audio is pitch-shifted and
  processed. Pitch tracking also fails on growled voices; when the numbers and your ears disagree,
  trust your ears.
- Gemini describes each voice relative to the others (age, pitch, timbre, texture, attitude, and
  the game's processing separately), ranks them, and drafts a prompt and a preview text for each.
  The page reveals which letter was which.
- Run it again if the two runs might disagree; keep what both agree on.

## 2. Write the prompt and the preview text

Press **Use this draft** under a flavor, **Design vN** on a slot, or **New version from vN** on an
older version. Template:

```
[Age] [gender] [race], [role: who uses this voice].
Unmistakably [masculine/feminine], [pitch], [timbre], [texture].
Speaks [pace], [energy], [attitude]. [What it is NOT, if needed.]
General American accent, [consonant quality].
Perfect audio quality, dry close-mic studio recording, no reverb or effects.
```

Lessons from round one:

- **Always end with the audio-quality sentence.** Without it, designed voices pick up room echo or a
  phone-line sound.
- **Words can shift the perceived gender.** "Higher than most", "slightly nasal", "wiry" and "tight"
  made a male orc sound female. Say "unmistakably masculine" (or feminine) and get attitude from the
  delivery, not from the pitch.
- **Mood words shift the race.** "Calm, wise, grounded, honor, warmth, deliberate" turned an orc into
  a tauren. Use words that fit the race and role, and say what to avoid ("not wise, not mystical").
- **The preview text shapes the voice as much as the prompt does.** A mentor line makes a mentor.
  Pick one of the slot's own lines under the form (100 characters at least).
- **Don't describe effects.** Undead echo or elemental reverb come out badly. Design a clean voice.
- **Keep the flavors of one race-gender consistent.** Share a base (age, accent, body) and add a few
  words per flavor, so they sound like one people.

Example (orc-male-guard, accepted on the first try):

```
A battle-hardened older male orc soldier, hulking and scarred. Low, dark, hollow voice with
heavy guttural gravel and an audible throat growl, rough and breathy at the edges. Speaks in
short, clipped, barked phrases with a slow, simmering menace between them; gruff, impatient
and intimidating, a guard who expects to be obeyed. General American accent, consonants
chewed and heavy. Perfect audio quality, dry close-mic studio recording, no reverb or effects.
```

## 3. Design, pick and save

- **Design 3 previews** calls Voice Design (`eleven_ttv_v3`) and keeps all three on the site. With
  openSMILE, each shows its pitch, roughness (HNR) and brightness (alpha ratio), and the page marks
  the deepest. Play them beside the slot's **Game clip**.
- The game clip is there to compare against, by ear. It is never sent anywhere when you design.
- Mark the best, then **Save preview N as a voice**. It is created in *your* ElevenLabs account as
  `design-<slot>-v<n>`, and you become its holder: only you can voice lines with it or delete it.
  Teammates see whose account it is in.

## 4. Hear it on real lines

**Voice 3 lines** voices three lines of NPCs using the slot (a long quest text, a short bark, a
gossip line) the way regeneration would for you: your model and voice settings for the language,
and its accent tags. Play each **New** beside **Live**, what players hear now. Judge against that,
not only against the game clip. Samples are kept with the version and never become takes.

## 5. Review and iterate

- Give the version a verdict: **Good**, or **Needs work** plus one sentence on what is wrong ("sounds
  female", "too wise, like a tauren"). Mark single clips good or off and pick the best preview.
- Turn that sentence into prompt changes: remove the words that caused it, add an explicit anchor,
  and change the preview text if it pulled the voice the wrong way. Then **New version from vN**.
  Old versions stay, folded under the newest. Usually 1–3 rounds per voice.
- Filter the page by **No design**, **Pending**, **Needs work** and **Good**, and search slots, NPCs,
  prompts and notes.
- Accounts cap custom voices. **Delete from ElevenLabs** on a version you will not use frees the slot;
  its audio stays here. A voice renamed into a slot since is refused, as it may be live.

## 6. Make it the slot's voice

The workbench never changes a slot's live voice. Once a version is good, rename its voice into the
slot on `/voices` (the account voice picker). That re-voices every line of the slot, which is its
own decision.

## Costs

- **Designing:** about the preview text's length in credits for each of the three previews.
- **Sampling:** the three lines' characters at your model's rate; the page shows both before you press.
- **Comparing:** a few cents of Gemini. openSMILE is free.
- Everything spends through the site with the presser's own keys. Nothing in the repo spends credits.

## openSMILE on the droplet

Measurements come from `apps/web/scripts/voice_measure.py`, run by the site with the interpreter in
`VOICE_ANALYSIS_PYTHON` (set in `shared/app.env`; the script path comes from `VOICE_ANALYSIS_SCRIPT`,
which `deploy/web/ecosystem.config.js` points at the release). That Python needs `opensmile`, and
ffmpeg on the path for mp3. Unset or failing, the page works without measurements. Test the helper
where `opensmile` is installed with `python -m pytest apps/web/scripts/test_voice_measure.py`.

## Designs made before this page

Round one's designs (made with scratch scripts, one `<slot>-v<n>/` folder each with `meta.json`,
`preview<k>.mp3` and `line<k>.mp3`, and a `reviews.json` beside them) come in once through the
**Import** panel at the foot of the page, which only admins see. Pick the folder holding them; each
version is created with its voice, samples and verdicts, and one already there is skipped. The
imported voices stay in the admin's account, who is their holder and can delete them from there.
