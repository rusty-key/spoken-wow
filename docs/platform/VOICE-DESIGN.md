# Designing an original voice for Spoken

The goal is a voice that suits a WoW character type without copying anyone's real voice. Game
recordings are only inspiration. ElevenLabs never receives them, only a written description.

**Reference clips (recordings from the game) are for comparison and inspiration only.** Never clone one, remix one, or upload one to
ElevenLabs (Voice Clone, Voice Remix or design-from-audio). The page says so wherever a reference clip
appears; the only places they go are Gemini's blind comparison and openSMILE. Voice Remix is used only
on our own designed voices, by their ID; no recording goes with it.

All of it happens on `/voices/design` (Backstage, "Design new voices" on `/voices`). Anyone with
`configure` in a language may design and review its slots; anyone who may see `/voices` may listen.
Every version belongs to the team, so the whole team sees, reviews and builds on it.

## Before you start

- Add your **ElevenLabs** key on your profile. Designing, saving and sampling spend from it.
- Add a **Gemini** key on your profile (Google AI Studio, API keys) to use the blind comparison.
  It costs a few cents a run.
- The comparison listens to each slot's reference clip: its fish.audio reference window, else the first
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

Press **Use this draft** under a flavor, **Design v1** on a slot without a version, or **New version
from vN** under **⋯** at the foot of a version. The form opens under the newest version. Template:

```
[Age] [gender] [race], [role: who uses this voice].
Unmistakably [masculine/feminine], [pitch], [timbre], [texture].
Speaks [pace], [energy], [attitude]. [What it is NOT, if needed.]
[Accent].
Soft, gentle s sounds. Clean professional audiobook recording, close to a warm studio microphone, natural and full-bodied, no harshness, no room echo.
```

The last sentence is required, verbatim; the form offers to add it, and Gemini's drafts always end
with it. Lessons from rounds one and two:

- **Soft s sounds come from the ending and from what you leave out (measured).** Round one's designed
  voices had s sounds far harsher than the live takes: the 95th percentile of the 5-10 kHz energy
  share was 0.40 in their sample lines against 0.09 in the live takes. Two things caused it. The old
  ending ("Perfect audio quality, dry close-mic studio recording, no reverb or effects") and any
  wording about consonants or sibilants ("crisp", "sharp", "hissing", "sibilant", "snappy
  consonants"). With the new ending and no such words, the median s-level over 45 slots fell from
  0.495 to 0.018 (live takes: 0.065). Voice settings do not fix it: speaker boost off and similarity
  0.4 left it unchanged. Keep `eleven_ttv_v3`: `eleven_multilingual_ttv_v2` had soft s sounds but far
  more room echo.
- **Words can shift the perceived gender.** "Higher than most", "slightly nasal", "wiry" and "tight"
  made a male orc sound female. Say "unmistakably masculine" (or feminine) and get attitude from the
  delivery, not from the pitch.
- **Mood words shift the race.** "Calm, wise, grounded, honor, warmth, deliberate" turned an orc into
  a tauren. Use words that fit the race and role, and say what to avoid ("not wise, not mystical").
- **The preview text shapes the voice as much as the prompt does.** A mentor line makes a mentor.
  Pick one of the slot's own lines under the form (100 characters at least).
- **Don't describe effects or post-processing.** Undead echo, elemental reverb or a pitch shift come
  out badly. Design a clean voice.
- **Keep the flavors of one race-gender consistent.** Share a base (age, accent, body) and add a few
  words per flavor, so they sound like one people.

Example (orc-male-guard, accepted on the first try):

```
A battle-hardened older male orc soldier, hulking and scarred. Low, dark, hollow voice with
heavy guttural gravel and an audible throat growl, rough and breathy at the edges. Speaks in
short, clipped, barked phrases with a slow, simmering menace between them; gruff, impatient
and intimidating, a guard who expects to be obeyed. General American accent. Soft, gentle s sounds.
Clean professional audiobook recording, close to a warm studio microphone, natural and full-bodied,
no harshness, no room echo.
```

## 3. Design, pick and save

- **Design 3 previews** calls Voice Design (`eleven_ttv_v3`) and keeps all three on the site. The
  three previews of one design differ enormously (s-levels of 0.74, 0.18 and 0.70 on one slot), so
  each is measured. The page shows its **s**-level (how harsh the s sounds are; live takes sit near
  0.07); its tooltip adds the **room** tail (the echo after a phrase, in dB), the speech **level** and,
  with openSMILE, pitch, roughness (HNR) and brightness (alpha ratio). Play them beside the slot's **Reference clip**.
- The page marks one **Recommended**, and gilds its **Save as voice** button: the softest s among the previews whose room tail is at most
  -17 dB and whose level is within 6 dB of the loudest; if none qualifies, the softest s. Your ears
  decide.
- The reference clip is there to compare against, by ear. It is never sent anywhere when you design.
- Press **Save as voice** beside the preview you want. It is created in *your* ElevenLabs account as
  `design-<slot>-v<n>`, and you become its holder: only you can voice lines with it or delete it.
  Teammates see whose account it is in. To use another preview instead, **Delete from ElevenLabs**,
  then save the other one; the old voice's sample lines go with it.
  Its verdicts stay: remove those that judged the old voice.

## 4. Hear it on real lines

**Voice 3 lines** voices three lines of NPCs using the slot (a long quest text, a short bark, a
gossip line) the way regeneration would for you: your model and voice settings for the language,
and its accent tags. Play each **New** beside **Live**, what players hear now. Judge against that,
not only against the reference clip. **Voice the lines again** replaces them. Samples are kept with the version and never become takes.

## 5. Review and iterate

- Give the version a verdict: **Good**, or **Needs work** plus one sentence on what is wrong ("sounds
  female", "too wise, like a tauren"). Write the note, then press **Good** or **Needs work**, which saves the
  verdict. Mark sample lines that sound right or wrong first; the marks go with it. Verdicts stack: a
  new one goes under the old, and the newest sets the version's status. Remove one given by mistake with its ✕.
- **Generate from review** at the foot of the newest version does the whole round in one press:
  Gemini rewrites the prompt from the review, then Voice Design makes the next version's three
  previews. It spends from both keys.
- Turn that sentence into prompt changes: remove the words that caused it, add an explicit anchor,
  and change the preview text if it pulled the voice the wrong way. Then **New version from vN** under **⋯**.
  Old versions stay, folded under the newest. Usually 1–3 rounds per voice.
- Or choose **Revise from review** under **⋯** (needs your Gemini key and the version's
  sample lines). Gemini hears the reference clip and the sample line marked wrong (else the first), reads the verdict and its note, the notes on the
  race's other flavors, and the old prompt and preview text, and fills in the next version's form
  with what it heard and a rewritten prompt. Notes travel across a race: write "trolls need a
  Jamaican accent" on one troll and every troll's revision reads it. It also works on a version
  nobody has reviewed yet, from its siblings' notes. Edit the draft, then **Design 3 previews**.
- **Remix from review** keeps the voice and changes only what the review asks for: Gemini writes the
  changes ("Add a thick Scottish accent. Keep the timbre and pace."), then ElevenLabs Voice Remix
  makes the next version from this version's voice. Gemini also rewrites the whole prompt, which the
  new version keeps as its description. Use it when the voice is close; use Generate
  when it is wrong at the root. Only the voice's holder can remix, and only while it is in their
  account. **Remix vN by hand** under **⋯** opens the form for the changes and the new voice's prompt. The settings button
  beside Remix sets prompt strength (0 keeps the voice, 1 follows the changes), guidance (lower is
  freer, high can sound artificial), loudness and seed (the same seed and inputs give the same
  voice); the browser keeps them for every remix. A remix costs about the preview text's length in
  credits, and ElevenLabs may return fewer previews than Voice Design's three.
- On the **Needs work** filter, **Generate all from reviews** runs Generate from review on every slot
  shown, one at a time, after asking with the total ElevenLabs cost. A slot whose design fails keeps
  Gemini's draft in its form.
- Filter the page by **No design**, **Pending**, **Needs work** and **Good**, and search slots, NPCs,
  prompts and notes.
- Accounts cap custom voices. **Delete from ElevenLabs** on a version you will not use frees the slot;
  its audio stays here. A voice renamed into a slot since is refused, as it may be live.

## Ask players

Players' opinions help you judge a voice. You make the final call.

- **Show to players** on a sampled version puts its three sample lines on the language's public
  **Listen** page (`/<lang>/listen`). Anyone, signed in or not, answers **Does this fit the
  character?** with Fits, Close, Doesn't fit or Skip, and can add a note. Each slot shows one
  version: the one shown last. Showing an older version again rolls back to it.
- Every press starts a fresh round of votes. A player's second vote in a round replaces the first.
- While players hear a version, its sample lines are locked: it cannot be sampled or saved again.
  Show another version first.
- Each version card lists every round's counts and notes, which only people who design voices in
  the language can see. **Hide** removes a spam note; its vote still counts.
- Tick **Use for the next version** on the notes worth acting on, then give your verdict: the
  ticked notes are kept with it, as they read then, and **Generate** and **Remix from review** hand
  every note picked in the version's verdicts to Gemini beside your own.
- Filter the page by what players say about the version they hear now: **Mostly doesn't fit**,
  **Mixed**, **Mostly fits** or **No votes yet**. "Mostly" is more than half of the answers given;
  skips count for nothing.
- Listen reads the language's first team (the one with plain packs), whoever is looking.
- When a slot is shown again, everyone who voted in an earlier round (Skip aside) gets an email,
  at most one a day listing every voice that changed. Signed-in voters are emailed at their
  account's address. Anonymous voters give an address on the page and confirm it first. Every email
  has a one-click unsubscribe. The emails go out from the droplet, every quarter hour.

## 6. Make it the slot's voice

The workbench never changes a slot's live voice. Once a version is good, rename its voice into the
slot on `/voices` (the account voice picker). That re-voices every line of the slot, which is its
own decision.

## Costs

- **Designing:** about the preview text's length in credits for each of the three previews.
- **Sampling:** the three lines' characters at your model's rate; the page shows both before you press.
- **Comparing and revising:** a few cents of Gemini each. Measuring is free.
- Everything spends through the site with the presser's own keys. Nothing in the repo spends credits.

## openSMILE on the droplet

Measurements come from `apps/web/scripts/voice_measure.py`, run by the site with the interpreter in
`VOICE_ANALYSIS_PYTHON` (set in `shared/app.env`; the script path comes from `VOICE_ANALYSIS_SCRIPT`,
which `deploy/web/ecosystem.config.js` points at the release). That Python needs `opensmile` for
pitch, roughness and brightness, `librosa` and `numpy` for s-level, room and level, and ffmpeg on
the path for mp3. Each part runs when its library is there; unset or failing, the page works
without measurements. Test the helper with `python -m pytest apps/web/scripts/test_voice_measure.py`.

## Designs made before this page

The designs made with scratch scripts (a `voices/` folder of `<slot>-v<n>/` folders, each with
`meta.json`, `preview<k>.mp3` and `line<k>.mp3`, and a `reviews.json` beside `voices/`) come in through
the **Import** panel at the foot of the page, which only admins see. Pick the scratch folder that
holds both; the page sends one version at a time and skips any already there, so it can be run again.
Each version keeps its prompt, previews with their measurements, chosen preview, sample lines, note,
Gemini's description (archetype, and what it heard for a revision) and every verdict in order, with
best preview and per-clip marks. A version whose voice was deleted from ElevenLabs
(`voice_deleted`) comes in as deleted. The `live-line` files are ignored: live takes come from the
site. The imported voices stay in the admin's account, who is their holder.
