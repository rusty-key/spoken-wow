# Changelog

Notable changes to ZoneLore and its sound packs. Both are versioned together:
see [Compatibility](#compatibility) below.

The addon and the pack have numbered themselves independently since 2.0.0, so a heading says
which of the two it belongs to when there is any doubt: a section headed `## <version> — audio`
is the pack's, and `scripts/zones/release.sh` matches on the kind as well as the number. A
section with no kind in its heading is the addon's. A language's pack numbers itself too, from
1.0.0, and its sections are headed by its release tag: `## <version> — zones-audio-esMX`.

## 1.0.0 — zones-audio-deDE — 2026-09-26

- **The first German sound pack**, `SpokenZonesAudio_deDE`: every zone and subzone
  Spoken Zones has lore for, read aloud in German. It plays only while Spoken Zones is
  showing German text, and installs beside the English pack rather than over it.

## 1.0.0 — zones-audio-esES — 2026-09-26

- **The first Spanish (EU) sound pack**, `SpokenZonesAudio_esES`: every zone and subzone
  Spoken Zones has lore for, read aloud in European Spanish. It plays only while Spoken Zones is
  showing Spanish (EU) text, and installs beside the English pack rather than over it.

## 1.0.0 — zones-audio-frFR — 2026-09-26

- **The first French sound pack**, `SpokenZonesAudio_frFR`: every zone and subzone
  Spoken Zones has lore for, read aloud in French. It plays only while Spoken Zones is
  showing French text, and installs beside the English pack rather than over it.

## 1.0.0 — zones-audio-ptBR — 2026-09-26

- **The first Portuguese sound pack**, `SpokenZonesAudio_ptBR`: every zone and subzone
  Spoken Zones has lore for, read aloud in Brazilian Portuguese. It plays only while Spoken Zones is
  showing Portuguese text, and installs beside the English pack rather than over it.

## 1.0.0 — zones-audio-ruRU — 2026-09-26

- **The first Russian sound pack**, `SpokenZonesAudio_ruRU`: every zone and subzone
  Spoken Zones has lore for, read aloud in Russian. It plays only while Spoken Zones is
  showing Russian text, and installs beside the English pack rather than over it.
  Ravaged Twilight Camp is not voiced yet and stays silent.

## 1.0.0 — zones-audio-esMX — 2026-09-26

- **The first Spanish (AL) sound pack**, `SpokenZonesAudio_esMX`: every zone and subzone
  Spoken Zones has lore for, read aloud in Latin American Spanish. It plays only while Spoken
  Zones is showing Spanish (AL) text, and installs beside the English pack rather than over it.

## 2.1.0 — 2026-09-21

- **Describe a place nobody has written about.** Where the map panel or the lore window says
  a place has no lore yet, a **Contribute** button sits right under that sentence. It hands you
  a link naming the place you are looking at -- not where you are standing, which is not
  sent -- and the page it opens asks you to describe it in your own words. Hide it with **Hide
  the Contribute buttons** in the Spoken Player settings.

## 2.0.3 — 2026-09-18

- **A new icon in the AddOns list**: a gold four-pointed star on the Spoken shield, replacing
  the ZoneLore **L**. Spoken Player and Spoken Quests wear the same shield with a mark of their
  own, so the three read as one family. The website's icon changes with it.

## 2.0.2 — 2026-09-18

Places the client knows but nobody has written about yet now appear in the panel.

- The **Forever** client (1.60.1) adds zones and subzones vanilla never had. Five zones --
  Mount Hyjal, Zephras Isle, Darkspear Islands, Riverglades and Shen'dralas -- and 91
  subzones are now listed by name.
- They have no lore yet. Selecting one says so rather than showing an empty panel, and the
  play button stays dark until there is something to read. Lore is being written; it will
  arrive in a later release without you needing to reinstall anything.
- Everything already written is unchanged.

## 2.0.1 — audio — 2026-09-18

- **A new icon in the AddOns list**: the gold four-pointed star on the Spoken shield that
  Spoken Zones now wears, so the pack and the addon that reads it are visibly a pair. The
  narration itself is unchanged.

## 2.0.1 — 2026-09-18

- **A fresh install no longer raises the client's "blocked from an action only available to the
  Blizzard UI" dialog.** This release carries a placeholder folder under the old `ZoneLore`
  name, so that your settings and narration history keep loading until they have been migrated;
  the addon switched that folder off on sight, and current clients refuse that to an addon and
  say so in a dialog of their own. A real ZoneLore install is still switched off, so it cannot
  narrate over this one.

## 2.0.0 — 2026-09-18

Renamed to **Spoken Zones**, and narration now plays through the **Spoken Player** addon
shared with Spoken Quests. Addon managers install it automatically.

- Settings migrate on first login from the old ZoneLore folder, which this release replaces
  with a tombstone that can be deleted afterwards.
- One queue with quest voiceover: a discovery no longer cuts off or is cut off by a quest
  line; each waits its turn. Narration held through combat no longer blocks a quest line.
- The player frame and minimap button are Spoken Player's; this addon adds its entries to
  the one button and its Read/Report buttons to the one frame.
- Report is an icon in the player's top right corner rather than a button beside the
  line. Spoken Player's settings can hide it.
- The Read button is gone from the player, and with it the setting that decided whether
  it stopped the narration. The lore text is still one click away on the map, in the
  minimap menu and from `/spz`.
- The settings panel is laid out by the same code as the other Spoken addons, so the
  three read alike and the spacing no longer varies from section to section.
- The sound pack and the language are dropdowns rather than buttons that cycled through
  the options one click at a time.
- The two places the addon still called itself ZoneLore in its own settings now say
  Spoken Zones.
- The sound channel moved to Spoken Player's panel, where one setting covers whatever is
  speaking. Your choice carries over unless Spoken Quests also had one, which wins.
- If Spoken Player is installed but switched off, a dialog offers to enable it and
  reload, rather than narration quietly not playing.
- The sound pack is renamed **Spoken Zones Audio** in the addon list and on CurseForge.
- A pack announces itself in `SpokenZonesAudioPacks`, and the addon still reads the old
  `ZoneLoreAudioPacks` too, so a pack you already have keeps working. The other direction does
  not: a 2.0.0 pack needs a 2.0.0 addon, and the two are released together.
- **Runs on the Forever client** (1.60.1, interface 16001 — the one whose TOC suffix is
  `_Camelot`), alongside Classic Era 1.15.9 and the 2.5.6 Anniversary client.
- **The login greeting no longer repeats on a client that forgets.** It narrates the area a
  new character wakes up in, once, guarded by a per-character flag — and a client that never
  restores saved variables (the 1.60.1 beta writes them every logout and reads none of them
  back, for any addon) made that flag always empty, so it narrated the current zone at every
  login. It now greets only a level 1 character there, which is the case it exists for.
- **The commands are `/spokenzones` and `/spz`**, matching `/spoken` and `/sp` on the player
  and `/spokenquests` and `/spq` on Spoken Quests. `/zonelore` and `/zl` are retired — a macro
  that used one has to be edited.
- **The sound pack installs as `SpokenZonesAudio`**, where it was `ZoneLoreAudio`. Your addon
  manager replaces the old folder; a hand-installed pack has to be deleted by hand or you keep
  two copies of the same audio.
- **The 64 kbps pack is retired.** It stays installable for anyone who has it and gets no
  further updates; the 128 kbps pack is the one to install.
- The addon and the pack carry the same version as the rest of Spoken from here on, which is
  why this is 2.0.0 and not 1.0.0.

## 0.4.3 — 2026-08-19

**An icon in the addon list**

- ZoneLore shows its own gold-shield icon beside its name in the in-game addon
  list, in place of the stock book it borrowed before. Nothing else changed.

## 0.3.3 — 2026-08-19 (sound packs)

**An icon in the addon list**

- Both packs show the ZoneLore shield beside their names in the in-game addon
  list, matching the addon they belong to. The audio is byte-for-byte 0.3.2.

## 0.4.2 — 2026-08-16

Two fixes, both about narration playing something it should not have. 0.4.1 was
never released; everything it fixed is in here.

**Missing narration is silent instead of playing someone else's quest audio**

- Any lore with no clip in your installed sound pack played a stand-in recording:
  a quest line about the League of Arathor. With no sound pack installed that was
  every entry, so the narration in Elwynn Forest, Dun Morogh, Felwood, Red Cloud
  Mesa and elsewhere was the same unrelated clip, and it sounded like the lore
  itself was wrong. It was not — the text was right, the audio was a placeholder.
- Nothing stands in any more. Where there is no recording the Play button does not
  appear and autoplay stays quiet, and asking for it directly says whether the
  sound pack is missing or simply does not cover that line yet.
- No lore text or narration changed. If you have a sound pack installed and heard
  the right clips, nothing about this release changes what you hear.

**A new character is greeted by its starting zone, not by its continent**

- Logging in a freshly created character narrated "Eastern Kingdoms" or
  "Kalimdor" instead of the valley it woke up in, on the Anniversary client. The
  world is still loading at that moment and the client answers "which map are you
  on?" with the continent, which ZoneLore took at its word.
- On Classic Era the same moment produced the opposite result: nothing was
  narrated at all, and the character was marked as already greeted, so it never
  got a second chance.
- Continents are never narrated automatically now. Their lore is still there to
  read on the map, and still plays on request.
- The login greeting waits for the game to settle rather than spending its one
  turn on the first answer it gets, so a new dwarf hears Coldridge Valley and a
  new orc hears Valley of Trials on both clients.

## 0.3.2 — 2026-08-16 (sound packs)

**Sixteen lines re-recorded**

- Azshara's places (Bitter Reaches, Forlorn Ridge, Hetaera's Clutch, Shadowsong
  Shrine, Storm Cliffs, Valormok), Satyrnaar, Brackenwall Village, Ametharan,
  Bash'al'aran, the Tower of Althalaxx, Darrowmere Lake, Thorn Hill and both
  Southfury River lines are re-recorded, mostly for pronunciation.
- Two of them follow a lore correction as well: Zul'jin is a troll warlord rather
  than an orc one, and Draz'Zilb is an ogre rather than a goblin.
- Alterac Mountains is the sixteenth. It was re-recorded back on 9 August, but the
  new clip never made it into a pack, so 0.3.1 shipped the older reading. This one
  has it.
- Everything else is byte-for-byte what 0.3.0 shipped. Requires ZoneLore 0.3 or
  newer, as any 0.x pack does.

## 0.4.0 — 2026-08-12

**Subzone lore works on non-English clients**

- On a German, French, Spanish, Portuguese, Russian, Korean or Chinese client,
  clicking a subzone showed nothing. The lore is stored under English place
  names, and those clients report their own — so roughly nine subzones in ten
  were unreachable for every player not running the game in English. ZoneLore
  now translates the client's name back before looking it up, using the game's
  own area table, and the lore appears.
- The lore text itself is still English everywhere. What changed is that it can
  now be found.
- Groundwork for reading ZoneLore in another language: a language setting exists
  in the options, and there is one language to choose. When a translation is
  finished it appears there, together with its own narration; an unfinished one
  is not offered at all, and a place with no lore in the language you are reading
  shows nothing rather than falling back to English.
- The sound packs are unchanged. A future pack declares which language it
  narrates; with several installed, ZoneLore prefers the one matching the language
  it is showing and lets you pick another in the options.
- The Report button's address now says which language you were reading, so a
  report lands beside the line it is about.

## 0.3.1 — 2026-08-10

**Works on the Anniversary client**

- ZoneLore and the ZoneLore Audio 64 pack now load on the Anniversary client
  (2.5.6) as well as Classic Era. Nothing about the lore changed: an Anniversary
  character gets the same text and the same narration across vanilla Azeroth,
  which is where the levelling happens.
- Outland and the blood elf and draenei starting zones have no lore yet. The
  panel is empty on those maps rather than wrong.

## 0.3.0 — 2026-08-09

**The vanilla rewrite, and a new narrator**

- The lore was rewritten across the whole corpus to describe the world as a
  1.12 character finds it: later-expansion world state, quest outcomes told as
  settled history, and game-mechanical phrasing are gone, after several full
  review passes over every line.
- Every line re-recorded with a new narrator voice.
- Many pronunciations improved, applied through the shared pronunciation
  dictionary.
- The packs now carry only places the Classic Era client can actually report;
  clips for later-era areas are gone, and with them roughly a third of the
  download.
- The standard pack (ZoneLore Audio 64) is now VBR — noticeably smaller at the
  same spoken quality.

Addon and packs both move to 0.3.0; either works with any 0.x of the other.

## 0.2.3 — 2026-08-04

**Narration for characters who already explored**

- Autoplay rides the game's own "Discovered Durotar" message, which fires once per
  character and never again. On a character who explored Azeroth before installing
  ZoneLore, all of those fired long ago, so the addon had nothing to say — the
  people most likely to want the lore heard the least of it.
- A new setting under Narration, **Also narrate areas you explored before
  installing**, has ZoneLore keep its own record instead and narrate when you
  enter an area rather than when the game announces it. Still one clip per area
  per character; it is off by default, and on a fresh character it changes nothing.
- `/zl forget` now clears that record along with the login greeting, so a
  character can hear the whole thing again.

Sound packs are unchanged — any 0.x pack works with this release.

## 0.2.2 — 2026-08-04

**Read what you are hearing**

- A **Read** button on the playback controls, opening the lore window on whatever
  is being narrated. Narration follows you out of the zone it started in, so the
  words behind a voice you want to reread were often nowhere on screen; finding
  them meant hunting the entry down by name.
- A setting decides whether it stops the narration as well — unticked, the voice
  keeps going and you read along; ticked, the button becomes **Read instead** and
  clicking it leaves you with the text alone. Find it under Narration.
- The controls are now two rows of two rather than one row of three, to fit the
  new button without becoming too wide to sit under the minimap.

Sound packs are unchanged — any 0.x pack works with this release.

## 0.2.1 — 2026-08-02

**Reporting a bad line is now a button press**

- A **Report** button on the map panel, the lore window and the playback
  controls. The client cannot open a browser or send anything anywhere, so it
  offers an address to copy: `lore.rusty.one/r/{zone}/{area}`, a page carrying
  that line's text, its narration and a form. Reporting a bad reading no longer
  means finding the line again among 1353 of them — and while a line is playing,
  the controls carry the button, so you never have to find it at all.
- Options gains a **Report a problem** link, for everything that belongs to no
  particular line: the addon erroring, the voice being wrong throughout.
- The options panel scrolls. It had grown more rows than fit the settings window,
  and the settings canvas neither scrolls nor clips what overflows it, so the last
  few sections were drawing over the game world instead of being reachable.

Both the lore text and the voice are beta, and which entries get rewritten first
follows what comes in. Sound packs are unchanged — 0.2.0 packs work with this
release, as any 0.x pack does.

## 0.2.0 — 2026-08-02

First public release.

ZoneLore shows the lore of the zone you are looking at, and reads it aloud.

**On the world map**

- A side panel on the world map carrying the lore of the zone in view. Dockable
  left or right, resizable, with an adjustable font size.
- Click a named subzone on the map to read its lore instead of the zone's. 1304
  subzones across 46 zones are covered.
- A hover preview: point at a subzone and the first lines appear in a tooltip,
  without changing what the panel is showing.

**Elsewhere**

- A standalone lore window for browsing zones without opening the map, reachable
  from the minimap button or `/zl window`.
- A minimap button, movable around the ring and hideable.
- An options panel under the game's own settings, or `/zl options`.

**Narration**

- Every zone and subzone entry is narrated — 1353 voicelines. Playback is a
  button beside the lore itself, with floating controls for pause, skip and stop.
- Autoplay: entering an area you have never discovered narrates it once. It stays
  discovered per character.
- Narration plays on the Dialog channel by default, so it rides the dialog volume
  slider rather than competing with it. Configurable.
- Audio ships separately, as a **sound pack** addon. ZoneLore works without one —
  the lore text is all in ZoneLore itself — and falls back to a placeholder clip
  so the playback controls still behave.

**Sound packs**

Two tiers, differing only in bitrate. Install either, or both:

| Pack | Bitrate | Download |
|---|---|---|
| `ZoneLoreAudio` | 128 kbps | ~790 MB |
| `ZoneLoreAudio64` | 64 kbps mono | ~400 MB |

With both installed, ZoneLore plays the higher-quality one. `/zl audio` lists
what is installed and switches between them.

**Data**

- 49 zones and 1304 subzones, built from warcraft.wiki.gg and filtered to what
  exists in Classic Era — no content from later expansions leaks in.

### Compatibility

- Clients: **Classic Era 1.15.9** and the **Anniversary client 2.5.6**
  (`Interface 11509, 20506`). Not built for retail. As of 0.3.1; earlier releases
  are Era-only.
- ZoneLore and a sound pack work together as long as they share a **major
  version**. 0.2.x ZoneLore reads any 0.x pack; a 1.x pack needs 1.x ZoneLore.
  ZoneLore says so in chat rather than going silent if it is handed a pack it
  cannot read.
