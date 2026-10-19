# Changelog — Spoken

Spoken Player until 3.0.0, when it became Spoken and took its modules into one download.

## Unreleased

- **Found books, quests and areas are listed in gold in the Compendium**, as the groups above them are.
  They were white, close to the grey of what is not found yet. *([Nucabe](https://github.com/Nucabe))*
- **The Spoken Manager can send the lines Spoken collects for you.** Turn on Sharing in the
  manager, and the lines Spoken had no voice for go to the site after each logout or /reload,
  so you no longer upload the file yourself. Collected lines now also say which version of your
  voice pack was playing, so the site can tell a line nobody has voiced from a pack that is out
  of date. The note Spoken shows before collecting says so.
  *([rusty-key](https://github.com/rusty-key))*
- **Every Compendium page has a round picture beside its title, and the lists are plain lines.** A place shows its
  picture with the world, a quest a scroll with the exclamation or question mark, a readable its kind with the
  training book. Zones and dungeons in the lists are lines with their count, as the groups are. A title
  is always one line. *([Nucabe](https://github.com/Nucabe))*
- **A readable's page is its text only.** The where-to-find-it lines are gone. *([Nucabe](https://github.com/Nucabe))*
- **A page with nothing to read shows your faction's wax seal in its middle.** Where the client has no seal
  it shows a faint lattice. It replaces the line telling you to choose something on the left, on the
  Compendium's pages for continents, zones, dungeons and groups. *([Nucabe](https://github.com/Nucabe))*
- **A page nobody has written yet says so in the same words on every tab, with Contribute under them.**
  Quests, Places and Readables use one message, and a quest part with no words gets Contribute too.
  *([Nucabe](https://github.com/Nucabe))*
- **Play stays on the Compendium's pages and quest parts, greyed where nothing is recorded.** Its
  tooltip says there is no voice for it yet. *([Nucabe](https://github.com/Nucabe))*
- **Rows in the Compendium are dimmed when their voice, picture or words are missing.** A line with nothing
  inside it has no plus button, and the Unlock switches no longer grey rows that have nothing found. The
  button that shrinks the window is the size of Close. *([Nucabe](https://github.com/Nucabe))*
- **A quest chain's page has the quest scroll, as a quest does, and the Classes, Professions, holiday and
  other group pages have icons of their own.** Each part of a quest's page is headed by who speaks it,
  over Description or Completion. *([Nucabe](https://github.com/Nucabe))*
- **Quest givers show their own face.** The quest portraits in the Compendium and the narrator's quest-giver
  face are drawn from appearances that ship with Spoken, so a creature the client has not met yet no longer
  shows your own face or another creature's. *([Nucabe](https://github.com/Nucabe))*
- **New module, Spoken NPCs, with a Bosses tab in Azeroth's Compendium.** It lists every boss of every
  dungeon and raid, under the zones that have one, then the dungeons and their bosses. A boss is found when
  its fight starts: one not found is greyed until you find it or turn on Unlock Unfound Bosses, and Found
  Only hides it. Zones and dungeons count what is found. A boss's page names its dungeon and zone, shows
  its face with a skull, and holds its story where one is written. *([Nucabe](https://github.com/Nucabe))*
- **Show Boss Abilities, on Spoken's settings page, puts each boss's spells under its story.** The spells are
  cards with the spellbook's frame. It is off by default. *([Nucabe](https://github.com/Nucabe))*
- **A boss's page tells its story.** 272 bosses have one, written from the Adventure Guide and Warcraft Wiki
  and kept to Classic. *([Nucabe](https://github.com/Nucabe))*
- **Every dungeon and raid has its own icon in the Compendium, and so do the cities, Moonglade and the
  battlegrounds.** *([Nucabe](https://github.com/Nucabe))*

## 3.5.1 — 2026-10-19

- **The objective tracker's Play buttons can be turned off.** Untick Show Play Button, under
  Objective Tracker on the Quests settings page, and the button beside each tracked quest goes
  away.
  *([rusty-key](https://github.com/rusty-key))*
- **Targeting or pointing at a unit whose GUID is secret no longer raises a Lua error.**
  Spoken Quests skips the hidden GUID before comparing or parsing it.
  *([Merryfett](https://github.com/Merryfett))*
- **Read Greetings reads each new greeting once, not each NPC.** Many NPCs greet you with one of
  several lines, and Once per NPC kept every line but the first one silent. The setting is now
  Once per Greeting: each line plays the first time you see it. Once for Quest Givers works the
  same way. Greetings heard before this update play once more.
  *([rusty-key](https://github.com/rusty-key))*
- **Spoken Contributions has its own icon in the AddOns list**, a heart, rather than none, and its
  name is no longer greyed out. No Spoken addon colours its name or description there any more.
  *([Nucabe](https://github.com/Nucabe))*
- **A quest that reads differently for you is voiced in your words.** Where a quest's text
  changes with who gives it or who takes it, Spoken plays the recording of the text on your
  screen, and where it has none for those words it plays nothing and offers Contribute.
  *([rusty-key](https://github.com/rusty-key))*
- **The Compendium's Minimize button is the same size as its Close button.** The two top-right
  buttons on the Compendium window were different sizes; the Minimize button now matches the
  Close button.
  *([anon1231823](https://github.com/anon1231823))*
- **An NPC whose words change with who asks no longer reads you the wrong line.** A trainer
  greets someone of its profession differently, and a barker sends each faction to its own
  place. Where the packs hold only another of these, the NPC used to read that one. Now it reads
  nothing and offers Contribute, so the line you saw can be added.
  *([rusty-key](https://github.com/rusty-key))*
- **Report files a line under the voice language you chose.** A line missing from your language
  plays in English instead, and reporting it used to land on the English page, where nobody
  looking after your language would see it. It now goes to your language's page.
  *([rusty-key](https://github.com/rusty-key))*

## 3.5.0 — 2026-10-17

- **Readables finds and reads pages only a language pack has.** A page that exists in your client's
  language but not in English, such as one a player sent in, is now recognised, placed in its
  book and read aloud once its language pack carries it, and Report works on it.
  *([rusty-key](https://github.com/rusty-key))*
- **The minimap button's tooltip shows Spoken's version.** It sits above the click hints, where
  a bug report can quote it without opening the settings.
  *([anon1231823](https://github.com/anon1231823))*
- **An NPC that comes in several races under one name now speaks in the voice of the race you
  see.** The Ironforge Reveler, for one, is a dwarf, a gnome or a human, and spoke with only one
  voice; it speaks in each now, once its packs have that voice.
  *([rusty-key](https://github.com/rusty-key))*

### Modules

- New icons for Spoken, Quests, Places and Readables in the AddOns list, on the minimap button and in
  Settings. A language's packs show the same icon with the language's badge, so they are told apart
  from the English ones. *([Nucabe](https://github.com/Nucabe))*

- Zones is now Places, in every language: its card, settings page, Compendium tab, menu entry, and the
  panel beside the map, now Place Story. Its commands are /spp and /spokenplaces, and /spz still
  works. Its folder is `Spoken_Places`, so each character's discovered places and the places it has
  heard start fresh, and Spoken asks you to delete a leftover `Spoken_Zones` folder. *([Nucabe](https://github.com/Nucabe))*
- Books is now Readables, in every language: its card, page, minimap entry, Compendium tab and AddOns
  list entry, and its folder, `Spoken_Readables`. Its commands are /spr and /spokenreadables, and /spw
  and /spb still work. Its settings and reading history start fresh, and Spoken asks you to delete a
  leftover `Spoken_Books` or `Spoken_Writings` folder. The parts are listed Quests, Gossip, Places,
  Readables everywhere, and the minimap menu names them in your language. *([Nucabe](https://github.com/Nucabe))*
- What NPCs say has its own switch and settings page, Gossip. Gossip and greeting windows can be turned
  off apart from quests, and Read Greetings, Original Thrall Speech and Forget Greetings Heard are on the
  Gossip page. NPC Voice Before Reading stays on the Quests page. Your settings are unchanged. *([Nucabe](https://github.com/Nucabe))*
- Spoken's modules load only with Spoken switched on. With Spoken off in the AddOns list, the game
  leaves Quests, Places, Readables and Developer off too, and no longer shows a dialog
  offering to switch Spoken back on. *([Nucabe](https://github.com/Nucabe))*

### Settings

- Read When Window Closes, on the Quests page, starts a quest's reading when you close the window
  instead of when it opens. It is off by default. *([Nucabe](https://github.com/Nucabe))*
- Show Narrator replaces Show Words, with a row under it for each of Quests, Gossip, Places and
  Readables. Turn one off to hear its lines without the window or subtitles, such as the quests', and
  keep them for the places and the writings. All are on by default. /sp narrator is the command, and /sp words still works. With
  it off for everything, the voice plays and nothing shows. *([Nucabe](https://github.com/Nucabe))*
- Area Highlight, on the Places page, sets how brightly an area lights under the pointer on a zone
  map, and turns the highlight off at 0. *([Nucabe](https://github.com/Nucabe))*
- The Welcome window uses the same cards and rows as the settings, scrolls when the screen is too
  short for them, and starts its questions at the left. *([Nucabe](https://github.com/Nucabe))*
- The Welcome window says so when no voice pack is installed, and where to download one.
  *([Nucabe](https://github.com/Nucabe))*
- Spoken's settings page is reorganised, with no Advanced part. The settings most players change
  come first: What Spoken Reads, Narrator Style (with Window Size, Subtitle Size, Show Narrator, Word Size and
  Lock Position), Language, Sound, While Spoken Reads, Keys, Azeroth's Compendium and Fix a Problem.
  The finer ones follow in named sections: Look, Words, Playback, Sound Levels While Spoken Reads,
  Contribute and Minimap Button, then Profiles. Theme is one row for the Small Window and one for
  DialogueUI. Show Welcome Window is a button on the What Spoken Reads heading. Fix a Problem holds Show
  Diagnostics, Report a Problem and Reset Positions. A row that waits on another switch is greyed
  with the reason, and most tooltips that repeated their row's name are gone. Every setting keeps
  its saved name and value, and no default changed. *([Nucabe](https://github.com/Nucabe))*
- Each page opens with Enable and When to Read, then Voice Packs (on Places, a
  Stories section comes between them), and ends with Reading History where it has one. A
  voice pack row is named by its language alone. Voice Language and If a Voice Is Missing are set
  once, on Spoken's page, and a choice made on the Quests page is copied there the first time. The
  debug switches moved to Spoken's Developer page, under Chat Messages and Testing.
  *([Nucabe](https://github.com/Nucabe))*
- Places and Readables keep their settings in Spoken's profile, so one profile holds everything, and
  Profiles on Spoken's page copy, switch and reset them with the rest. What the account had saved
  is kept and copied under the same names to each character's profile at login, and a profile made
  or reset later starts from the defaults. A profile that reads the stories in another language
  than the one loaded says so and asks for /reload. *([Nucabe](https://github.com/Nucabe))*
- Keep Reading in Background, a new switch under Playback, lets you hear Spoken with the game window
  in the background. While a line plays it turns on the game's Sound in Background, which plays the
  game's other sounds too, and puts your own value back once the last line ends, after a reload or
  at the next login. A change you make to that setting meanwhile is kept. Off by default.
  *([Nucabe](https://github.com/Nucabe))*
- Names and tooltips were read again in every language: a part or control has one name wherever it appears,
  tooltips that still described old behaviour say what the control does now, and the voice packs are called
  voice packs in chat and in the missing-pack messages. *([Nucabe](https://github.com/Nucabe))*

### Battlegrounds

- Read in Battlegrounds, a new switch under While Spoken Reads, is on by default. Turned off, Spoken
  reads nothing by itself in a battleground or an arena, and what was waiting stops as you arrive. A
  line you ask for, with Play, a command or the Compendium, is still read.
  *([Nucabe](https://github.com/Nucabe))*

### Narrator styles

- The windows and the subtitles are drawn to the screen's edges and middle as you drag them, with a
  gold guide line where they hold, and the subtitles now move sideways as well as up and down. The
  DialogueUI window also holds on its resting place. Hold Shift to drag freely.
  *([Nucabe](https://github.com/Nucabe))*
- The round Play, Skip and Report buttons are dark at 90% inside their ring instead of solid, so the
  world shows a little through them. *([Nucabe](https://github.com/Nucabe))*
- Ctrl and the mouse wheel size the Small Window and the subtitles, as they do the DialogueUI
  window. Ctrl and the wheel change Window Size, or Subtitle Size over the subtitles, and Ctrl,
  Shift and the wheel change Word Size. Without Ctrl the wheel over the subtitles and the windows
  still zooms the camera. With Lock Position on, no window and no subtitles change size, and the wheel scrolls the
  words. *([Nucabe](https://github.com/Nucabe))*
- The subtitles and the DialogueUI window say why a line waits, as the Small and Large Windows do:
  "(Waiting for combat to end.)" or "(Waiting for the NPC to finish speaking.)" after the line's
  title. The subtitles show a line held back this way instead of nothing until it starts.
  *([Nucabe](https://github.com/Nucabe))*
- The "+N" after a line's title lists the lines waiting when you point at it, each with who says it,
  in the windows and the subtitles. It does nothing when clicked.
  *([Nucabe](https://github.com/Nucabe))*
- Bronze Border, on Forever, tints every round button Spoken draws: the subtitles' portrait ring,
  the faces on the Compendium's quest pages, the Large Window's move button and the Small Window's
  right-click menu border. The faces change with the setting at once.
  *([Nucabe](https://github.com/Nucabe))*
- The Small Window's size grabber is the game's own, the one Azeroth's Compendium and the chat
  windows have. *([Nucabe](https://github.com/Nucabe))*
- The windows' sample line no longer tells you to drag its words, which do not move a window. It
  says to move the window and turn on Lock Position. The subtitles' sample, which can be dragged by
  its words, is unchanged. *([Nucabe](https://github.com/Nucabe))*
- The DialogueUI narrator style's picture on Spoken's page has no scrollbar, as the window itself
  has none. *([Nucabe](https://github.com/Nucabe))*

### Azeroth's Compendium

- The line under a page's title is plain words and no longer a link, and the Azeroth page is gone. The
  continents are the top of the Places list. On the map, the line under an area's name still goes back to
  its zone. *([Nucabe](https://github.com/Nucabe))*
- The Open in Compendium button has a darker, tighter vignette inside its ring, so the ring and the
  book read apart. *([Nucabe](https://github.com/Nucabe))*
- A locked row says why it does not open when you point at it, and names the switch that opens
  it. The pick lines on the Places, Dungeons and Readables pages mention Shift-click to queue a
  story or a writing after what is playing, as the Quests page does. *([Nucabe](https://github.com/Nucabe))*
- A page's Play and Report buttons stand at the scroll bar's right edge, and stay there
  whether or not the bar shows. The Compendium's icon is the library book: in the window's
  portrait and on every Open in Compendium button. *([Nucabe](https://github.com/Nucabe))*
- Azeroth's Compendium is part of Spoken. Its Quests tab no longer needs Places or Readables switched
  on, and the window keeps its size in Spoken's settings, so it opens once at its default size. Text
  Size on Spoken's page sets the words of every tab and of the Place Story panel beside the map.
  *([Nucabe](https://github.com/Nucabe))*
- Every tab lists its places in one style. Each continent and each type (Classes, Professions,
  Holidays and Events, a kind of writing under By Type) is a banner. Each zone, city and dungeon is
  a card showing how much of it you have found, with a bar, and everything else is a row. A group
  such as a quest chain or Dungeons and Raids is a row that opens to what it holds, with its count.
  The art is the game's own, and several cards stay open at once, so opening Elwynn Forest does not
  close Alterac Mountains. The window opens scrolled to where you are. A tab reached from another
  tab shows where you stand and keeps a place you chose. The row under a page's title says where the
  page is and how much of it you have found, such as "In Kalimdor · 1 of 88 completed", and a click
  on it goes up a level. *([Nucabe](https://github.com/Nucabe))*
- Search matches names. It lists what matches under what holds it, and a match on a banner, card or
  chain lists everything inside it, so a dungeon's name finds all it holds. Places you have not
  discovered are listed greyed out. A filter that hides the chosen row moves the page to the nearest
  place or row above it that is still listed, or to where you stand. The page used to go on showing
  a row no longer there. *([Nucabe](https://github.com/Nucabe))*
- A zone's, city's or dungeon's page on Quests and Readables has the place's picture from Places, with
  Places and Show Pictures on. *([Nucabe](https://github.com/Nucabe))*
- Play works as the quest log's. It shows Stop while its line is read and Replay once you stop it.
  Stop leaves the line in the queue, and Play while the queue is stopped plays at once. A queue
  emptied while stopped no longer stays stopped, so the next line plays. Report is on every quest
  part, story and writing, voiced or not, so words no pack has recorded can be reported, and Play
  shows where there is a voice for it. Play and Report have the same tooltips on every tab.
  Shift-click a quest, a story or a writing to queue its voice behind what is playing. The page
  stays on what you had chosen. *([Nucabe](https://github.com/Nucabe))*

### Azeroth's Compendium: Quests

- The objective tracker has a Play button at the right end of each quest's title, the same button
  the quest log has. Both stop and replay a quest's line as the round buttons do, and say so in a
  tooltip. *([Nucabe](https://github.com/Nucabe))*
- The Play button on each row of the quest log has the tracking checkbox's border and the Play and
  Stop glyphs the narrator styles use. *([Nucabe](https://github.com/Nucabe))*
- The Quests tab is new. It lists the quests your character's side, race and class can take, by zone
  (a Skyborne character sees its side's quests and the Skyborne's own), with class, profession,
  holiday and other quests apart. Quests no one can take are not listed. A quest you have started or
  completed opens, and one in your quest log is marked In progress and counts with the completed.
  The rest are greyed until Unlock Unstarted Quests is on, in the Compendium section of Spoken's
  page. Started Only and Voiced Only are in the filter menu, and Defaults on the Quests page turns
  both off. With no quests where you stand, or the filters hiding your zone, the tab opens on your
  continent. On a client in another language, a quest shows in that language once you have seen its
  window. Open in Azeroth's Compendium, on the quest giver's window, the quest log's details and
  DialogueUI's window, opens the tab on that quest, also when the filters hide it. Switching Quests
  off closes the tab. *([Nucabe](https://github.com/Nucabe))*
- Quests are filed where Forever's own client files them. A zone with a dungeon or raid holds its
  quests in a Dungeons and Raids row. Each holiday has its own group under Holidays and Events,
  Children's Week included, Camping sits with Professions, and Argent Dawn and Library Books are
  under Other. Battlegrounds and Other Lands, which holds Zephras Isle, have banners. The Scourge's
  invasion quests are under Scourge Invasion in every language, and no group holds a single quest:
  CLUCK! is in Westfall and Tirisfal Glades, where its chicken feed is sold, and The Goddess
  Provides is in Teldrassil. Quests that follow one another are one chain row, named after its first
  quest you can take, and chains of one name in one place are numbered. The row shows how many of
  its quests you have completed and how many are in progress, with a tick once you finish it, and
  its page asks you to choose a quest. *([Nucabe](https://github.com/Nucabe))*
- A quest's page has two parts, Description and Completion. Each shows the round portrait and name
  of who says it, with the part's badge, and has its own Play and Report. Completion is said by the
  NPC you hand the quest in to, and stays hidden until you have completed the quest, unless Unlock
  Unstarted Quests is on. There is no progress part, so Voiced Only and shift-click count only
  Description and Completion, and a quest voiced only in its progress counts as unvoiced. Eight
  quests whose pages had no words show them as their Description, from what the NPC says while the
  quest is under way. Conflict at Darkspear Islands, Forced Disarmament and the two Donations of
  Wool are among them. *([Nucabe](https://github.com/Nucabe))*
- The tab lists 25 quests Forever gives that Spoken has no words for yet, such as Changing Tastes
  and Conflict at Darkspear Islands, in their zones or class groups. Their pages read "No words yet:
  this quest has not been recorded." in every language. *([Nucabe](https://github.com/Nucabe))*
- Searching with Voiced Only on no longer asks every quest's voice again on each key you type. It
  asks when a pack loads or you change the voice language. *([Nucabe](https://github.com/Nucabe))*

### Azeroth's Compendium: Places

- The Places tab lists dungeons and raids as cards inside the zone of their entrance, under a
  Dungeons and Raids row where the zone has several. Forever's City of Dalaran and Ruins of
  Lordaeron are cards inside Alterac Mountains' and the Undercity's, with their stories. A Dungeons
  and Raids row shows a page with how many of the zone's dungeons and raids you have discovered, and
  a way back to the zone. Razorfen Downs tells its story at its entrance in The Barrens: standing
  there, discovering it or clicking it on The Barrens' map plays and shows its story, and the
  Compendium opens on its card. *([Nucabe](https://github.com/Nucabe))*
- Zones you have not discovered work as they do on Quests and Readables. A zone's card is greyed only
  while nothing in it is found, its areas are listed greyed with a padlock, and Discovered Only
  leaves out only the places not found. The page of a place not discovered says where it is, how
  much of it you have found, and to go there to read its story. A story stays hidden until you
  discover it, unless Unlock Undiscovered Places is on. *([Nucabe](https://github.com/Nucabe))*
- A story's page is the Compendium's page. Play, Report, the title and the row under it, the divider
  and the words are the ones Quests and Readables use, so a change to one shows on all three. The
  page looks as before, on the spellbook's parchment in the window and the quest log's beside the
  map, and Contribute and Open in Azeroth's Compendium stay. *([Nucabe](https://github.com/Nucabe))*
- Strahnbrad and the other places the game puts in Alterac Mountains are in Alterac Mountains. The
  Compendium lists and counts the twelve under Alterac Mountains instead of Hillsbrad Foothills, and
  standing in one, discovering it or clicking it on Alterac Mountains' map plays and shows its
  story. Places you found before still count. The Great Lift, Lordamere Lake and Darrowmere Lake
  tell their stories from both zones they border, and on Forever the Valley of Bones is listed in
  Shen'dralas. Also on Forever, Legashi Encampment in Azshara tells its story, the one Spoken has
  for the camp under its older name, Legash Encampment, and is listed once. Northshire Valley -
  Camelot and Storm Cliffs, which no one can reach there, are no longer listed.
  *([Nucabe](https://github.com/Nucabe))*

### Azeroth's Compendium: Readables

- The Readables tab files what is found inside a dungeon or raid under its card, in the zone of its
  entrance, as Quests does: the Dark Keeper nameplates under Blackrock Depths, the lore books under
  Scholomance and the Scarlet Monastery. A zone with several dungeons holds them under a Dungeons
  and Raids row. Under a zone, city or dungeon, the writings are in a row for each kind: Books,
  Journals and Diaries, Letters, Notes, Scrolls, Tablets and Runes, Plaques and Signs, Gravestones,
  Exhibits, Pictures and Maps and Other. Each starts closed. Writings found in too many zones to
  list under each are under Across Azeroth. Journals were split between Books and Notes, a writing
  with no words, such as the Crude Map, is a Picture, and about 90 writings moved to the kind their
  title or words say: Maybell's Love Letter is a letter and Uther's tomb a gravestone.
  *([Nucabe](https://github.com/Nucabe))*
- The writings of the seasonal events, Winter Veil's, the Harvest Festival's poems, the fishing
  tournament's flier and the Scourge invasion's letters and reports, are under Holidays and Events,
  where they were under Place Unknown or in the cities where the event's NPCs stand. A writing's
  page shows how it is had ("Dropped by Defias Messenger (Westfall)") as a part of its own above its
  words, under Where to Find It, and a writing found in several places lists them on one row, cut
  short with "and N more". *([Nucabe](https://github.com/Nucabe))*
- Open in Azeroth's Compendium, a round tome button on the book frame and in DialogueUI's book view,
  opens the Readables tab on that writing with what holds it opened. It shows for writings you have
  found, or any with Unlock Unfound Readables on. *([Nucabe](https://github.com/Nucabe))*
- Each writing is listed in the zone where it is found. Writings near a zone's border are no longer
  under the zone next door: the letters handed out in Darkshire were under Deadwind Pass. The
  Librams and Nat Pagle's guide name the creatures you meet instead of the server's copies. The 26
  writings no one can have, beta items with no words and Forsaken letters never handed out, are
  gone, and eight that were among them, such as Gnomeregan's punch cards and the Snapshot of
  Gammerita, are listed in the zone they come from. *([Nucabe](https://github.com/Nucabe))*

### Languages

- The quest pack Spoken suggests for your language links to its download again. It pointed at CurseForge
  pages that now hold only part of a language's quests; it now opens the one-pack download on GitHub.
  Chinese clients are offered their own pack too, instead of English's. *([rusty-key](https://github.com/rusty-key))*
- Places reads in Spoken's Voice Language and follows If a Voice Is Missing, as the other modules do.
  Its Text Language sets the language of the story's words. *([Nucabe](https://github.com/Nucabe))*
- In every language list, a language whose script the game's font cannot draw is named in English.
  *([Nucabe](https://github.com/Nucabe))*
- On Forever in German, Spanish, French, Portuguese, Russian, Korean and Chinese, Places finds the
  places Forever added or renamed, such as Die Schwarzschlundfeste and Die Abendruh, by the names
  Forever's own client gives them. *([Nucabe](https://github.com/Nucabe))*

### Commands

- New commands: /sp replay, /sp stopall, /sp style, /sp words, /sp rows, /sp compendium and /sp
  collect, which turns Collect Missing Lines on and off as the switch on Spoken's page does. /sp
  diagnostics prints Spoken's diagnostics and then each module's, and /spp diagnostics and /spw
  diagnostics print one module's. /spw status and a bare /spp still show their status. /sp help
  lists them in the settings' own words, and the older words (transcript, player, play, pause, stop)
  still work. A key binding opens Azeroth's Compendium, and the minimap menu and the Small Window's
  menu have the same playback rows. *([Nucabe](https://github.com/Nucabe))*
- /spq play, /spq pause and /spq clear are gone, as are the language rows on the /spq window. /sp
  and Spoken's page do those, for every module. *([Nucabe](https://github.com/Nucabe))*
- /spp minimap is gone. It showed or hid a Places minimap button that only appeared without Spoken.
  Spoken's own button is the one to use. *([Nucabe](https://github.com/Nucabe))*
- /spb gather is gone. /sp collect does the same. *([Nucabe](https://github.com/Nucabe))*

### Reports

- A report says what you saw. The address Report gives also carries the addon version, your game
  client, the text on screen and the NPC you spoke to, so whoever reads the report sees what went
  wrong without asking. It is a longer address, shown in Spoken's copy box, and the report page
  says what it will send. *([rusty-key](https://github.com/rusty-key))*

### Fixes

- The Places tab and the Place Story panel beside the world map sit against the map's visible frame, at
  its height. With Leatrix Maps' simple map frame on, that is the frame Leatrix draws, with or
  without the quest log open. *([Nucabe](https://github.com/Nucabe))*
- Text Size and Lines on Spoken's page apply at once in the DialogueUI and Small windows, without a
  reload. *([Nucabe](https://github.com/Nucabe))*
- Lines and icons in Azeroth's Compendium (the faint lines down open cards, the card bars, the
  badges) and the square Play buttons are sized in whole screen pixels, so they no longer come out
  jagged or a pixel too thick at some interface scales. *([Nucabe](https://github.com/Nucabe))*
- A class name in a quest only that class can take is no longer sent to the site as a stand-in
  for the player's class, so a paladin quest's "paladin" is not voiced as "adventurer".
  *([Nucabe](https://github.com/Nucabe))*
- Silence NPC Voices no longer mutes an NPC when Spoken has no line to play for it. On a client
  whose language Spoken has its own gossip text for, every NPC counted as voiced even with no voice
  pack installed, so the game's greeting was cut for nothing. An NPC counts as voiced only where a
  pack holds a line for it, and the game's voice comes back as soon as a window turns out to have
  none. *([Nucabe](https://github.com/Nucabe))*
- A quest from a poster or an item shows a posted notice or the item's icon when played from the
  quest log or Azeroth's Compendium, as it does when its dialog opens. It showed the book.
  *([Nucabe](https://github.com/Nucabe))*
- A writing keeps its icon as its voice moves to the next page. A note showed its letter icon on
  the first page and the generic book from the second, and a tablet lost its stone.
  *([Nucabe](https://github.com/Nucabe))*
- With DialogueUI, the pages a gossip option leads to, such as a guard's directions, are read again
  when NPC Greetings is Once per NPC. Picking an option in DialogueUI was not noticed, so they were
  held back with the greeting. *([Nucabe](https://github.com/Nucabe))*
- A voice pack's row on the Quests and Gossip pages shows its version once the packs have loaded after
  /reload. It said Not loaded until you left the page and came back. *([Nucabe](https://github.com/Nucabe))*
- Azeroth's Compendium opens in a dungeon without an error on Quests and Readables. The game hides
  where you stand there, so the tab opens on the first continent. *([Nucabe](https://github.com/Nucabe))*
- Play a Test Line on the Quests and Gossip pages shows a line of words in the subtitle and the Small
  Window, where it showed an empty box. *([Nucabe](https://github.com/Nucabe))*
- With the DialogueUI narrator style, a queued line's page flew in with no window to go behind.
  Closing a dialog on another line, such as a greeting before a quest or a gravestone before a book,
  now fades the window back in at once while the queued page goes behind it.
  *([Nucabe](https://github.com/Nucabe))*
- A book's title shows on the DialogueUI window the first time it plays. It could stay blank after a
  quest line until another book played. *([Nucabe](https://github.com/Nucabe))*
- A book's highlighted word keeps pace with its voice from the start. The recording of a book's
  first page reads its title before the words, and the highlight began at once, running ahead the
  whole page. It now starts once the title is said. Pages that open with their own title, as
  gravestones do, start at once as before. *([Nucabe](https://github.com/Nucabe))*
- The subtitles show the speaker's face once the game has it. A quest giver the game had not loaded
  yet kept the book for the whole line. *([Nucabe](https://github.com/Nucabe))*
- An empty dark circle no longer shows on the portrait. The Small Window and the subtitles drew the
  badge's dark backing at the face's lower right on lines with no badge, the sample line among them.
  *([Nucabe](https://github.com/Nucabe))*
- Reset Positions moved back only the window in use. It now forgets where the Small, Large and
  DialogueUI windows and the subtitles were put, as its tooltip says.
  *([Nucabe](https://github.com/Nucabe))*
- Unlock Unfound Readables fits its row on Spoken's page in German and French, where it was cut
  short. *([Nucabe](https://github.com/Nucabe))*
- Forever hides some names, words and ids from addons in dungeons, battlegrounds and combat, and
  Places raised an error over a discovery message in Shadowfang Keep and Blackfathom Deeps. Spoken
  and its modules now pass over a hidden value quietly. *([Nucabe](https://github.com/Nucabe))*
- Report on a line an object says, such as a wanted poster, opens that object's lines, not those of
  a creature with the same number. *([Nucabe](https://github.com/Nucabe))*
- A zone story's Report opens the line in the language it was read in. A German story's report used
  to open the English line. *([Nucabe](https://github.com/Nucabe))*
- A quest's Report copies a spoken.rusty.one address, the site's own, instead of the old
  voiceover.rusty.one one that redirected there. *([Nucabe](https://github.com/Nucabe))*
- Stop When Quest Closes works with Read Automatically off. A quest line started with the Play
  button kept playing after the quest window closed. *([Nucabe](https://github.com/Nucabe))*
- With Quests switched off, a quest window no longer cuts off the NPC's own greeting, and the
  DialogueUI window no longer holds the quest's words back for a moment. *([Nucabe](https://github.com/Nucabe))*
- With Read in Battlegrounds off, a quest or gossip window in a battleground or arena no longer cuts off the
  NPC's own greeting for a line that is never read. *([Nucabe](https://github.com/Nucabe))*

## 3.4.0 — 2026-10-12

- **A character is greeted by its zone only once, in its starting area.** An existing
  character could hear the lore of wherever it logged in, such as a level 1 character parked in
  Stormwind, the first time it logged in after updating to 3.0 or after the game crashed. The
  login greeting now plays only for a level 1 character in the valley it started in.
- **Spoken's Play, Skip and Report sit at the top right of DialogueUI's quest window.** Play
  turns to Stop while its line speaks and is greyed where no pack has the line, where Report
  offers Contribute in place of the old "No voice-over playing?" line. A close button sits
  beside them. *([Nucabe](https://github.com/Nucabe))*
- **The DialogueUI settings are on Spoken's page, with the other narrator styles'.** They show when
  DialogueUI is the narrator style, and every style's settings come in the same order: Size and
  Position, Look, Words. Show Sample Subtitle is gone, as Preview shows every style.
  *([Nucabe](https://github.com/Nucabe))*
- **Subtitles get the windows' settings, and the windows type by letter.** Subtitles gain Show Name
  and Title, Highlight Words, Auto-Scroll line by line or page by page, Text Size and Hide Portrait.
  Type By sets whether a window types out words or letters. *([Nucabe](https://github.com/Nucabe))*
- **Each narrator style shows only the settings it uses.** Show Progress is for Subtitles and every
  window, and Voice Only shows none of the words' settings. Spoken Quests' DialogueUI switches have
  a DialogueUI section of their own after the narrator style's settings. On Forever, Bronze Border
  has left the narrator style's settings for a Colours section: it colours every round button Spoken
  draws and the small window's metal. *([Nucabe](https://github.com/Nucabe))*
- **The large window is the game's Talking Head frame.** Its words sit inside the box, under the
  speaker's gold name, beside the portrait (a 3D model where there is one). Stopped and a count of
  the lines waiting follow the name in place of the queue's rows, Stop, Skip and Report take the
  close button's corner, and a progress line runs under the words. It fades in and out, from one
  line to the next too, and goes while a DialogueUI dialog hides the interface, where its 3D
  portrait stayed behind. Clients without the Talking Head's art draw Spoken's own in the same
  places. *([Nucabe](https://github.com/Nucabe))*
- **The small window has the DialogueUI window's controls, on parchment.** Stop or Replay, Skip
  and Report are round buttons in its header, a progress line runs under the words, and the title
  says "• (Stopped)" and how many lines wait, in place of the list. Its new Background setting
  draws it on parchment, the default, or on the dark rock it had. It fades in and out more
  slowly, from one line to the next too, and goes while a DialogueUI dialog hides the interface. *([Nucabe](https://github.com/Nucabe))*
- **Guards and other NPCs that come as a man or a woman speak in the voice of the one in front of
  you.** A Stormwind City Guard, an Orgrimmar Grunt or a Bluffwatcher can be either, and every
  one of them spoke in a man's voice. Until a pack has the other voice, the line plays as before.

## 3.3.1 — 2026-10-11

- **Fixed: contributing a quest started from an item in your bags sent no item.** The
  contribution now names the item, so its quest can be voiced without someone looking the item
  up by hand.

## 3.3.0 — 2026-10-11

- **Each quest giver is heard in its own voice.** A quest several NPCs give is recorded once per
  voice among them, and Spoken plays the one for the NPC you are talking to. Greetings and the
  lines NPCs say after a quest follow the same rule. Until a pack has that voice, the line plays
  as before.
- **Greetings are found in every client language.** Spoken carries each greeting's text in your
  client's language, so a German or Korean client finds the line whatever language its voice
  packs speak, instead of guessing it from the English text.
- **Fixed: under NPC Greetings "Once per NPC", the pages an option leads to stayed silent** once
  the NPC's greeting had been heard, such as a guard's directions. Only the greeting an NPC opens
  with counts toward "once" now.
- **Abandoning a quest while its voice speaks fades the voice out.** Before, it was cut off
  mid-word and the quest's next line started for a moment. *([Nucabe](https://github.com/Nucabe))*
- **Fixed: Books and Zones said "Not installed" in Spoken's module list after login**, and a
  module's settings page could show it switched off after it was switched on from Spoken's page.
  *([Nucabe](https://github.com/Nucabe))*
- **A book is one entry in the queue.** Skip skips the rest of the book, and a gravestone or
  letter opened while a book is read waits behind it instead of replacing it. The windows show
  the readable's kind over its name, such as Book or Gravestone, in place of the page count, and
  the progress bar runs across the whole book. Read Book as One Line, on by default, turns it off for
  a line per page with its page count, as before. *([Nucabe](https://github.com/Nucabe))*
- **Volume Follows is back.** Choose which volume slider Spoken's voices follow: Master, Effects,
  Music, Ambience or Dialog. On Dialog, a note says which features stop working there.
  *([Nucabe](https://github.com/Nucabe))*
- **Hide Report Buttons hides every Report button.** It sits beside Hide Contribute Buttons and
  also takes Report off the quest log, DialogueUI's window, the lore beside the map and the
  Compendium. *([Nucabe](https://github.com/Nucabe))*
- **NPC voices you switched off (the Dialog channel) stay off.** With Spoken on another channel,
  they came back on after any line it read, from an NPC's window, a zone or a book.
  *([svengabr](https://github.com/svengabr))*
- **Spoken Zones no longer raises a Lua error on chat messages the game keeps hidden from addons**,
  as in a dungeon group. *([svengabr](https://github.com/svengabr))*
- **Captions fade at their edges as they glide.** The line leaving at the top fades out and the
  line coming in at the bottom fades in, where they were cut off at the edge.
  *([Nucabe](https://github.com/Nucabe))*
- **With the DialogueUI narrator style, Spoken's small window takes DialogueUI's look.** When a
  dialog closes on a line still playing, the window slides out of it, with Stop, Skip and Report in
  its header and a place's picture over its words. *([Nucabe](https://github.com/Nucabe))*
- **With the DialogueUI narrator style, books show in DialogueUI's paper and plaques and gravestones
  in its stone.** Spoken's window stays hidden while DialogueUI's book view is open and slides out
  of it when it closes. *([Nucabe](https://github.com/Nucabe))*
- **The DialogueUI window settles into place with animation.** A queued line's page tucks behind the
  window, and the words fade from one line to the next. *([Nucabe](https://github.com/Nucabe))*
- **Alt-tabbing no longer loses the line.** With Sound in Background off, the game silences
  Spoken's voice when you switch away. The line now stops instead of running on in silence, and
  Replay plays it from the start. *([svengabr](https://github.com/svengabr))*
- **A zone's story is headed by the place it is in.** It showed its own name twice, as
  "Mulgore / Mulgore". The narrator now shows a zone's continent over it and a city's zone, and
  the Compendium's "In ..." line names the same place. *([Nucabe](https://github.com/Nucabe))*
- **Books can close themselves once read.** Turn on *Close Book When Done Reading* (or `/spb close`)
  and a book, letter or plaque shuts after its last page has been read aloud. With DialogueUI's
  book view, that brings back the interface it hides. The Spoken window now shows a book's title in
  your client's language, and names a one-page letter by its title instead of an internal key.
  *([earlsinclairdino](https://github.com/earlsinclairdino))*
- **Narrator Style Settings drops its box.** Small titles with a thin line separate its groups of
  settings, and the welcome window lists the narrator styles as the settings page does.
  *([Nucabe](https://github.com/Nucabe))*
- For feature addons: `present.font` on a clip draws its speaker, title, queue row, captions and
  subtitle in that face, for a script the game's font has no glyphs for. A face the client cannot
  load leaves the player's own. *([damesene](https://github.com/damesene))*
- **Zone Lore offers Korean, Chinese and Russian on every client.** The lore and its captions are
  written in the game's own fonts for those languages. *([Nucabe](https://github.com/Nucabe))*
- For feature addons: `present.timings` on a clip, the time each word of its transcript starts,
  moves the captions and subtitle with the voice instead of the estimate. `Spoken:CaptionWords`
  lists the words to time; a list that does not match them is ignored. *([damesene](https://github.com/damesene))*

## 3.2.0 — 2026-10-08

- **Lore of Azeroth is now Azeroth's Compendium, with a Books tab.** The Zones tab lists each
  place once, with cities inside their zone, and greys out the places you have not discovered,
  with a padlock and a found / total count. The Books tab lists every book, letter, note and
  plaque, by zone or by type, each found once you open it. A filter menu beside the search shows
  only what you found or only what is voiced. Open it, and unlock it, from Spoken's settings page
  or the minimap menu. *([Nucabe](https://github.com/Nucabe))*
- **The place under the cursor lights up on a zone map**, and what lights up is what a click
  opens. Clicking a city on its zone's map opens the city, and clicking an area with a story
  opens Zone Lore when it is closed. *([Nucabe](https://github.com/Nucabe))*
- **DialogueUI support.** With the DialogueUI addon installed, quest text in its window types
  out and highlights the words as the voice reads them, long text scrolls to follow the voice,
  and DialogueUI's own Play button plays the voice-over. A new DialogueUI narrator style draws
  Spoken's window in DialogueUI's art, and can follow its parchment or dark theme. Spoken's
  window or subtitles can stay visible over DialogueUI. Report a problem and Contribute work in
  DialogueUI's window. Its settings are on one page, Spoken > DialogueUI, shown only when
  DialogueUI is installed. *([earlsinclairdino](https://github.com/earlsinclairdino))*
- **NPC voices are cut, not faded, the moment their window opens**, and quest windows are
  silenced before the game says which quest it is. Skip now fades the line out, as Stop does.
  *([Nucabe](https://github.com/Nucabe))*
- **Game Greeting First**, a new setting, off by default: the NPC finishes its greeting, then
  Spoken speaks. To tell the greeting apart, Spoken keeps the Dialog volume 1% away from the
  other sliders. Thanks to AstroOat for the idea. *([Nucabe](https://github.com/Nucabe))*
- **Spoken always plays through Master Volume.** Volume Follows is removed: on Dialog,
  silencing NPCs silenced Spoken too. *([Nucabe](https://github.com/Nucabe))*
- **Left-click on Spoken's minimap button opens the settings, right-click the menu.** A profile
  that changed the clicks keeps its own, and the tooltip says which click does what.
  *([Nucabe](https://github.com/Nucabe))*
- **The settings page counts the voice packs you have.** A module's card shows how many voice
  packs it has installed. The voice pack lists offer the packs in the language you hear, plus
  any you already have, rather than every English pack too. The narrator style's settings sit in
  a box of their own. *([Nucabe](https://github.com/Nucabe))*
- A Quests voice pack switched off in the AddOns list stays off: it is no longer loaded, played
  or counted. *([Nucabe](https://github.com/Nucabe))*
- Zone Lore beside the map fades with it as you walk again, and the button that reopens it is a
  side tab, like the game's own panels, where the client has one.
  *([Nucabe](https://github.com/Nucabe))*
- Zone Lore has pictures for 16 more places in Kalimdor, and Darrowmere Lake and Three Corners
  show the places as they were in Classic. *([Nucabe](https://github.com/Nucabe))*
- On Forever, Bronze Border also colours the round buttons, such as Play and Report, and shows
  with every narrator style. *([Nucabe](https://github.com/Nucabe))*
- Turning the Spoken button off in the addon compartment stays off after a reload.
  *([RomainDel59](https://github.com/RomainDel59))*
- Opening the settings in combat, which the game does not allow, now says so instead of doing
  nothing. *([earlsinclairdino](https://github.com/earlsinclairdino))*
- **Spoken Developer, a module of its own, with a debug log to send with a report.** Installed and
  turned on (in Spoken > Developer, the welcome window or `/spoken log on`), it notes every line
  queued, started, stopped, dropped or refused, with the time and the reason, and the
  diagnostics. Right-click any Report or Contribute button to copy it with the diagnostics, or to
  write it for an AI agent on your computer (a snapshot of the moment, then a reload so the game
  saves the file). On once installed, and can be turned off; Spoken without it is unchanged. See
  [DEBUG-LOG.md](DEBUG-LOG.md). *([earlsinclairdino](https://github.com/earlsinclairdino))*
- For feature addons: `Spoken:Log`, `AddDiagnostics`, `AddDeveloperSettings`, `AddLogSource`
  and the rest, all doing nothing without the module.
- **A sound between queued lines, if you want one** (Sound > Sound Between Lines). At a quest hub
  a hand-in and the next pickup, often in the same NPC's voice, no longer run together: when a
  line finishes and another is waiting, the game's quest-log-close sound plays halfway through
  the pause before the next. Off by default, and never between the pages of one book.
- Pause Between Lines only runs when another line is waiting. After the last line Spoken is
  done as soon as the voice ends, so its window closes and the game's NPC voices come back
  without the extra wait.
- With greetings set to Once per NPC, what an NPC says after you pick one of its options plays
  again, like a guard's directions. Only the greeting it opens with is held back.

## 3.1.0 — 2026-10-06

- **Auto-Scroll for the window's captions.** It replaces Turn Pages Automatically and has three
  choices. Line by Line, the default, moves the text up a line at a time as the voice reaches
  each line, so the captions no longer jump a whole page. Page by Page is the old behaviour.
  Off keeps the text still. If you had switched page turning off, Auto-Scroll starts at Off.
  The mouse wheel scrolls by lines and keeps the text where you leave it. Subtitles Only is
  unchanged. *([earlsinclairdino](https://github.com/earlsinclairdino))*
- **Zone pictures are chosen by hand.** The pictures picked automatically from the wiki showed
  the wrong place in some areas, Felwood among them. They are replaced by 827 hand-picked,
  checked and cleaned-up pictures covering Azeroth, the Eastern Kingdoms, Kalimdor and Zephras
  Isle. About 110 areas without a checked picture show none, rather than a wrong one.
  *([Nucabe](https://github.com/Nucabe))*
- **Closing Zone Lore beside the map keeps it closed.** It used to come back each time the map
  opened. While it is closed, a button on the map's top-right edge reopens it, and so does
  turning it back on with `/spz panel`. *([Hitrem](https://github.com/Hitrem))*
- **The Lore of Azeroth window can be resized and collapsed.** Drag its corner to resize it.
  The size is kept across reloads. The button in the title bar folds the window down to the
  list of places, and choosing a place opens the text again.
  *([Hitrem](https://github.com/Hitrem))*
- Clicking a zone on a continent's map, such as Mulgore on Kalimdor, opens that zone's lore, not
  the lore of one of its areas. *([Nucabe](https://github.com/Nucabe))*
- **Fewer hangs with the gamepad UI on the Forever client.** While the gamepad UI is on, the
  notices Spoken used to show as popups at login ("No usable sound packs", "Spoken is required",
  old folders found) are printed in chat instead, because those popups could make the next
  window close fail and hang the client. Zone Lore and its reopen button are now placed beside
  the map rather than inside it, so closing the map with the gamepad is no longer blocked.
  As a side effect, the panel no longer fades with the map while you move.
  *([rusty-key](https://github.com/rusty-key))*

## 3.0.1 — 2026-10-05

- **NPC voices are muted again under gossip and greetings.** In 3.0.0 an NPC's own greeting
  played over Spoken's gossip line. It is silenced again as the window opens. Quest text still
  fades the NPC's voice out instead of cutting it. *([rusty-key](https://github.com/rusty-key))*

## 3.0.0 — 2026-10-05

**Spoken Player is now Spoken, and it comes with its modules.** One download holds Spoken,
Spoken Quests, Spoken Zones and Spoken Books, each in its own folder and grouped under Spoken
in the AddOns list. Voice packs stay separate downloads and need no update. Everything below
is new since Spoken Player 2.3.2, Spoken Quests 2.2.2, Spoken Zones 2.2.1 and Spoken Books
2.1.1. The four 3.0.0 betas are folded into it.

### Before you update

- **Install Spoken Player, then remove the old module downloads.** Spoken Quests, Spoken Zones
  and Spoken Books are no longer separate downloads. Their last update leaves a folder that
  never loads, listed greyed out as "Spoken Quests (now in Spoken)" and the like. Uninstall
  them in your addon manager and delete the `SpokenQuests`, `SpokenZones` and `SpokenBooks`
  folders from `Interface\AddOns`. The modules now live in `Spoken_Quests`, `Spoken_Zones` and
  `Spoken_Books`. If a full old copy is still there, Spoken switches it off at login and
  offers **Reload Now**, so no line plays twice. *([rusty-key](https://github.com/rusty-key))*
- **Unzipping by hand over Spoken Player works.** The download carries a `SpokenPlayer` folder
  that never loads, so the old player can't run beside Spoken. It is safe to delete. At login
  Spoken also asks you to delete `VoiceOverRedux` and `ZoneLore` if they are still there.
  *([rusty-key](https://github.com/rusty-key))*
- **Settings start fresh.** Settings are saved under new names, and nothing carries over from
  2.x: Quests' autoplay choice, the once-per-NPC greeting history and the record of zones
  already narrated all start again. Lines gathered in `SpokenContributions.lua` are kept.

### Narrator and subtitles

- **Four narrator styles.** Pick Subtitles Only, Small Window, Large Window or Voice Only in
  the welcome window, on the settings page or with `/sp player`. Subtitles Only is the default
  on modern clients. The 1.12, 2.4.3 and 3.3.5 clients start in the Large Window.
  *([Nucabe](https://github.com/Nucabe))*
- **Subtitles Only** shows the speaker and the words low on screen, typed a little ahead of the
  voice. It takes its look from shorley's Spoken Subtitles. A picture sits before the name:
  the NPC's face, the item that started the quest, a posted notice, the tablet or plaque a page
  is written on, or the zone's icon. Then comes what the line belongs to: the quest, the area
  or the page. *([Nucabe](https://github.com/Nucabe))*
- **A progress bar** runs under the words, and "+N" says how many lines are waiting. Stop or
  Replay, Skip and Report sit in a row underneath. **Show Progress** turns the bar off.
  *([Nucabe](https://github.com/Nucabe))*
- **Sentences at Once** (1 to 4, 3 by default) sets how many sentences the subtitle shows to a
  page. A sentence too long for a page turns at its commas and dashes rather than mid-phrase.
  *([Nucabe](https://github.com/Nucabe))*
- Chinese captions light up one character at a time, not all at once.
  *([rusty-key](https://github.com/rusty-key))*
- Portraits work on 2.4.3 and 3.3.5, and the Small Window no longer draws a wanted poster as a
  black disc. *([Nucabe](https://github.com/Nucabe))*

### Playback

- **Stop and Replay replace Pause.** The game can't resume a sound part-way through, so the
  button says what it does: Stop while a line plays (the line stays, marked "(Stopped)"),
  Replay to hear it from the start, Play once it has ended. The windows, the subtitle, the
  minimap menu and the key binding all work this way. Skip on a stopped queue plays the next
  line, and a reload never starts you stopped. *([Nucabe](https://github.com/Nucabe))*
- **Play no longer cuts off the line speaking.** A line you start by hand queues behind it.
  *([Nucabe](https://github.com/Nucabe))*
- **Pause Between Lines** (Audio, 1 second by default, 0 to 5) puts quiet between one line and
  the next. Book pages read on without it. *([Nucabe](https://github.com/Nucabe))*
- **Other sounds are turned down while a line plays.** Music, ambience, effects and NPC voices
  each have their own level, and come back up when the queue falls quiet. A volume you change
  mid-line is kept. *([Nucabe](https://github.com/Nucabe))*
- **NPC voices are kept for gossip and greetings**, and faded rather than cut when a quest's
  text plays. *([Nucabe](https://github.com/Nucabe))*

### Settings

- **Settings follow Blizzard's layout**: module cards you can switch off, the narrator styles
  as pictures, one voice language for every module, Profiles, and search.
  *([Nucabe](https://github.com/Nucabe))*
- Links to Wago and to Buy Me a Coffee join GitHub, Discord and CurseForge.
  *([Nucabe](https://github.com/Nucabe))*
- Every tooltip and setting was checked against what it does, in all nine languages.
  *([Nucabe](https://github.com/Nucabe))*
- New and changed text is translated into German, Spanish, French, Korean, Brazilian
  Portuguese, Russian and both Chinese scripts. *([Nucabe](https://github.com/Nucabe),
  [anon1231823](https://github.com/anon1231823))*

### Zones

- **Zone Lore is a panel beside the world map**, and **Lore of Azeroth**, the old lore window,
  lists Azeroth, its continents, zones and areas, with search. The line under a place's name
  ("in Durotar") takes you one level up. *([Nucabe](https://github.com/Nucabe))*
- **A picture of each place** sits above its story: a screenshot from the zone's or area's
  Warcraft Wiki page. **Show Pictures** turns them off. *([Nucabe](https://github.com/Nucabe))*
- Forever's Zephras Isle, Darkspear Islands, Riverglades and Shen'dralas have zone icons.
  *([Nucabe](https://github.com/Nucabe))*
- Russian, Korean and Chinese lore are offered on clients in other languages when the font
  can draw them. *([Nucabe](https://github.com/Nucabe))*
- On Forever, the map panel and the lore window wear the map's metal frame.
  *([rusty-key](https://github.com/rusty-key))*
- Zone narration no longer starts on its own while you are flying.
  *([Jared-Mac](https://github.com/Jared-Mac))*
- A cinematic stops zone narration that is already speaking
  ([#199](https://github.com/rusty-key/spoken-wow/issues/199)), and the login greeting waits
  until a new character's intro is over instead of missing it.
  *([rusty-key](https://github.com/rusty-key))*

### Quests

- **Italian** is in **Voice Language**, for the Italian sound pack. No game client runs in
  Italian, so Auto never picks it: choose it yourself. *([rusty-key](https://github.com/rusty-key))*
- Quest details: Play on a line waiting behind a stopped one plays it.
  *([Nucabe](https://github.com/Nucabe))*

### Books

- A page read through DialogueUI shows what it is written on, not a book.
  *([Nucabe](https://github.com/Nucabe))*
- `/spb read` says why nothing started. *([Nucabe](https://github.com/Nucabe))*

### Removed

- Explain in Chat, the LoreTeller row in the quest log, and stories on the left of the map.

### Thanks

- [Nucabe](https://github.com/Nucabe), who designed and wrote most of this release: the
  narrator styles, the subtitles, the settings, Zone Lore, Lore of Azeroth and the pictures.
- [Jared-Mac](https://github.com/Jared-Mac), for keeping zone narration quiet in flight.
- [anon1231823](https://github.com/anon1231823), for testing every beta and for the translations.
- shorley, whose Spoken Subtitles the subtitle's look comes from.

## 3.0.0-beta.4 — 2026-10-05

- **Stop and Replay replace Pause.** The game can't resume a sound part-way through, so the
  button now says what it does: Stop while a line plays (the line stays, marked "(Stopped)"),
  Replay to hear it from the start, Play once it has ended. The windows, the subtitle, the
  minimap menu and the key binding all follow. Skip on a stopped queue plays the next line, and
  a reload never starts you stopped.
- **Play no longer cuts off the line speaking.** A line you start by hand queues behind it.
- **Pause Between Lines** (Audio, 1 second by default, 0 to 5) puts quiet between one line and
  the next. Book pages read on without it.
- **The subtitle has a picture and a progress bar**, after shorley's Spoken Subtitles: the
  NPC's face, the item that started the quest, a posted notice, the tablet or plaque a page is
  written on, or the zone's icon, then the name and what the line belongs to. A progress bar
  sits under the words (**Show Progress** turns it off), "+N" says how many lines wait, and
  Stop or Replay, Skip and Report sit in a row underneath.
- **Sentences at Once** (1 to 4, 3 by default) sets how many sentences the subtitle shows to a
  page. A sentence too long for a page turns at its commas and dashes rather than mid-phrase.
- **NPC voices are kept for gossip and greetings**, and faded rather than cut when a quest's
  text plays.
- **Zone pictures**: a picture of each zone and area above its story, in the Zone Lore panel
  and in Lore of Azeroth. **Show Pictures** turns them off.
- Zone Lore: the line under a place's name ("in Durotar", "in Kalimdor") is in the
  map panel too, and goes one level up when clicked.
- Zone Lore offers Russian, Korean or Chinese lore on a client of another language when its
  font can draw them.
- Zone narration no longer starts automatically while flying. Thanks to Jared-Mac.
- Forever's Zephras Isle, Darkspear Islands, Riverglades and Shen'dralas have zone icons.
- Books: a plaque read through DialogueUI shows the plaque, not a book, and `/spb read` says
  why nothing started.
- Portraits work on 2.4.3 and 3.3.5 again, and come back to the subtitle after switching from
  the Small Window.
- Links: Wago and Buy Me a Coffee.
- Every tooltip and setting re-read against what it does, in all nine languages.

## 3.0.0-beta.3 — 2026-10-04

- **The modules have new folder names**: `Spoken_Quests`, `Spoken_Books` and `Spoken_Zones`.
  The old names belong to the Spoken Quests, Spoken Zones and Spoken Books downloads, which
  retire now that Spoken carries the modules. With their own folders the modules are safe from
  whatever the CurseForge app does to one of those old downloads still installed. Titles in the
  AddOns list are unchanged.
- **The old `SpokenQuests`, `SpokenZones` and `SpokenBooks` folders become harmless.** The last
  update of each old download leaves a folder that never loads, listed greyed out as
  "Spoken Quests (now in Spoken)" and the like. It is safe to delete. A full old copy still in
  Interface\AddOns would play every line a second time, so at login Spoken switches it off and
  offers **Reload Now**. Delete the folder when you can.
- **The modules' settings start fresh once more.** The game names a module's settings file
  after its folder, so the new folders begin without one: Quests' settings and profiles, Zones'
  and Books' settings, and the record of greetings heard and zones narrated. Spoken's own
  settings are kept, including which modules are switched off, and so are the lines gathered in
  `SpokenContributions.lua`.

## 3.0.0-beta.2 — 2026-10-04

- **Unzipping over an older Spoken Player works.** The download now carries a `SpokenPlayer`
  folder that never loads. Unzipping it over the old one leaves the old player nothing to load,
  so it no longer runs beside Spoken: no more "attempt to index local 'object'" error from
  LibDBIcon and no more popup asking you to delete the folder. The folder is safe to delete.

## 3.0.0-beta.1 — 2026-10-04

A beta. **Spoken Player is now Spoken**, and it comes with its modules: one download holds
Spoken, Spoken Quests, Spoken Books and Spoken Zones, each its own folder, grouped under Spoken
in the AddOns list. Voice packs stay separate downloads.

- **Everyone starts fresh.** Settings are saved under new names and nothing is carried over
  from earlier releases, including Quests' autoplay choice, the once-per-NPC greeting history
  and the record of zones already narrated. Lines gathered in `SpokenContributions.lua` are kept.
- **Delete the old folders.** At login Spoken looks for `SpokenPlayer`, `VoiceOverRedux` and
  `ZoneLore` left behind by an older release and asks you to delete them.
- **Four narrator styles**: Subtitles Only, the default on modern clients, Small Window, Large
  Window and Voice Only. Pick one in the welcome window, on the settings page or with
  `/sp player`. Legacy clients start in the Large Window.
- **Subtitles Only** shows the speaker and the words low on screen, four lines at a time, typed
  out a little ahead of the voice, with play/pause, skip and Report on hover.
- **Other sounds are turned down while a line plays**, each channel to its own level, and back
  up when the queue falls quiet. A volume you change mid-line is kept.
- Pausing fades the voice out. The round Play and Report buttons are shared by the subtitles,
  the quest log and Zone Lore.
- **Settings follow Blizzard's layout**: module cards you can switch off, the narrator styles as
  pictures, one voice language for every module, Profiles, and search.
- **Zone Lore** is a panel beside the world map. **Lore of Azeroth**, the old lore window, lists
  Azeroth, its continents, zones and areas, with search.
- Removed: Explain in Chat, the LoreTeller row in the quest log, and stories on the left of
  the map.
- New and changed text is machine-translated into German, Spanish, French, Korean, Brazilian
  Portuguese, Russian and both Chinese scripts.

## 2.3.2 — 2026-10-02

- **Report is back on Minimal Classic.** The bug icon sits in the player's top-right corner
  again instead of only in the right-click menu. **Hide the Report button** hides it, as it does
  on the original player.

## 2.3.1 — 2026-10-02

- **Forever build 70170 is recognised again.** That build reports a different client type,
  so the player stopped treating it as Forever: the **Bronze tint** setting disappeared and
  portraits lost the HD models. The player now recognises Forever by its version number,
  which keeps working whatever client type later builds report.

## 2.3.0 — 2026-10-01

- The player remembers its position, width and expanded captions across `/reload` and logins.
- Quests played from the quest log show the giver's face.
- The NPC's greeting is muted as the dialog opens, instead of cut off mid-word. Needs Spoken Quests 2.2.0.
- Game dialogue no longer stays muted after a logout or `/reload` mid-line ([#167](https://github.com/rusty-key/spoken-wow/issues/167)).

## 2.2.4 — 2026-09-29

- Quest and NPC captions appear inside the player with one or two lines and
  two-word highlighting. Timing is approximate. Change the settings under
  `/spoken options`; scroll to read and click the text to follow again.
- Zone lore and book pages use the same captions. A small plus/minus button
  switches between compact captions and an eight-line reading area in either layout.
- Caption settings and tooltips follow the game client language in German,
  Spanish (EU and Latin America), French, Brazilian Portuguese, Russian, Korean,
  Simplified Chinese and Traditional Chinese. This includes expand and collapse.
- **Missing lines are gathered by default.** Every quest, conversation and page Spoken has
  no voice for is kept for you to send in one go; nothing leaves the game unless you upload
  the file yourself. Turn it off with **Gather missing lines automatically** in the Spoken
  Player settings, now the one place the switch lives.
- **Spoken in the addon compartment.** On the clients that have Blizzard's addon compartment,
  the Spoken button shows there too, and opens the settings on the first click. **Show Spoken
  in the addon compartment** switches it.
- **Quest lines play with sound effects switched off.** Spoken Quests checks each line exists
  before queueing it, and that check ran on the sound effects channel, so with effects off
  every quest line was dropped as missing. It now checks on the channel the line plays on.

## 2.2.2 — 2026-09-26

- **Minimal Classic matches the Forever client's bronze.** On WoW Forever the panel's border,
  cast bar trim and portrait ring now take the same bronze tint as the game's own frames,
  instead of standing out in plain metal. **Bronze tint** under `/sp options` turns it off; it
  is on by default and only offered on Forever. Other clients are unchanged.

## 2.2.1 — 2026-09-23

- **No more Lua error on logout or `/reload` with the Minimal Classic layout.** When its
  settings were all still at their defaults, the game dropped them while logging out, and the
  panel went on laying itself out as the UI was taken down and failed to find them. It falls
  back to the defaults now. On the WoW Forever beta this happened on every logout and reload.

## 2.2.0 — 2026-09-22

- **A second layout, and it is the one the player opens in.** **Minimal Classic** is a
  compact panel on the modern clients: a round portrait of the speaker taken from the
  client's own art, the name in gold, the line's title under it and a slim cast bar. There
  is no permanent row of buttons — click the portrait to pause or start the line again,
  click the title to skip it, right-click anywhere on the panel for playback and for the
  source's own actions.
- **The queue folds away.** A plus button beside the panel counts the lines waiting and
  opens them; scroll for more than four, click one to drop it, and the whole drawer closes
  again. A book or a zone line carries its own badge on the portrait, so it is clear which
  addon is speaking without reading the title.
- Designed and written by [shorley-gm](https://github.com/shorley-gm), who contributed it
  in [#46](https://github.com/rusty-key/spoken-wow/pull/46) along with the artwork notes
  and an offline harness that drives the real queue and UI code.
- **The original layout is one setting away.** Turn off **Minimal Classic player** under
  `/sp options` and the player looks exactly as it did in 2.1.0; the hide-portrait,
  hide-player and per-action settings apply to both. `/sp reset` resets whichever layout
  is showing.
- Not on the 1.12, 2.4.3 and 3.3.5 clients, where it is neither offered nor drawn. They
  keep the original player.

## 2.1.0 — 2026-09-21

- **Sending the game's text where Spoken has no voice.** When Spoken Quests, Spoken Zones or
  Spoken Books has nothing for what is on screen, its Contribute button opens a small box
  holding a link. Copy it, open it in a browser and press Send: the link already carries the
  text straight from your client, so there is nothing to paste. It is compressed, so a long
  book page still fits in one link.
- **Or gather them as you play.** The first time you press Contribute you can choose to send
  just that line, or to let Spoken quietly keep every line it has no voice for and send them
  all at once. They are kept in a file of their own, `SpokenContributions.lua` in your
  `SavedVariables` folder, which you upload at spoken.rusty.one/contribute whenever you like.
  Nothing leaves your game until you do. `/spoken share` shows the steps again. Gathering
  stops at the 2,000 most recent lines.
- **A new Contributions section in the settings**: **Gather missing lines automatically**
  turns gathering off, **How to send them** shows the steps, **Clear gathered lines** empties
  the file once it has been sent, and **Hide the Contribute buttons** turns every one of those
  buttons off in one place.
- **The settings scroll.** With the new rows, the minimap and addon sections ran off the
  bottom of the window on the modern clients' settings panel.
- The link box has the keyboard as soon as it opens, so copying straight away works the
  first time too.
- The zip carries a second folder, **SpokenContributions**, which holds nothing but the
  gathered lines' file. An addon manager installs it with the player; installing by hand,
  copy both folders into `AddOns`.
- Not on the 1.12, 2.4.3 and 3.3.5 clients, where contributing is off for now.

## 2.0.4 — 2026-09-18

- **The portrait is a portrait again on the Forever client.** Selecting camera 0 of the
  creature's own model is what has framed the speaker's head on every client this addon
  runs on; the Forever client accepts that call and ignores it, so the whole NPC stood in
  the box instead. It is framed with the portrait zoom there, which that client honours.

## 2.0.3 — 2026-09-18

- **The minimap button's texture is DXT5, like every other texture Spoken ships.** The
  palettized BLP the 2.0.2 button used is legal by the format's own rules, but the Classic
  beta client asserts inside its image decoder the moment it loads one and takes the game
  down. The mark is unchanged; only the encoding is.

## 2.0.2 — 2026-09-18

- **The minimap button wears the play triangle.** It carried a crest inherited from VoiceOver
  Redux that, at the size the minimap draws, was a brown smudge. The button is the one place
  every Spoken addon is reached from, and it now shows the same mark as the AddOns list — the
  gold triangle on the dark field, without the shield frame, since the minimap draws a frame
  of its own around it.

## 2.0.1 — 2026-09-18

- **A new icon in the AddOns list**: a gold play triangle on the Spoken shield. Spoken Quests
  and Spoken Zones wear the same shield with a mark of their own, so the three read as one
  family without any two of them looking like the same addon listed twice.

## 2.0.0 — 2026-09-18

The player every Spoken addon speaks through: one queue, one window, one minimap button.

- **Runs on the Forever client** (1.60.1, interface 16001 — the one whose TOC suffix is
  `_Camelot`), alongside Classic Era 1.15.9 and the 2.5.6 Anniversary client.
- **`/sp` is a short form of `/spoken`**, matching `/spq` for Spoken Quests and `/spz` for
  Spoken Zones. One scheme across the three addons.
- **Every Spoken addon carries the same version from here on.** This is the player's first
  release, so 2.0.0 is a number it never earned on its own — it is Spoken Quests', and the
  three addons ship together and are supported together. A player comparing two of them
  should not have to work out which numbering each follows.
- Extracted from VoiceOver Redux and ZoneLore, which each carried their own copy.
- One FIFO across every addon; nothing interrupts. Gossip yields to quest dialogue at the door.
- Narration held through combat no longer blocks a quest line queued behind it.
- Report is an icon in the player's top right corner rather than a button beside the line,
  and it can be switched off under Player window. The 1.12, 2.4.3 and
  3.3.5 clients, whose art does not include that icon, get a lettered button instead.
- A quest line plays with its NPC and its title shown. The portrait is resolved before the
  rows, and asking a model frame a question the current clients no longer answer abandoned
  the rest of the update, leaving a portrait over an empty band.
- `/spoken` is a command the client recognises. It never was.
- The minimap button's tooltip gets out of the way when the menu opens, instead of
  sitting over it.
- The minimap menu is the client's own on every client that has one, so it looks and
  behaves like every other addon's: entries grouped under each addon's name, a highlight
  under the cursor, closing on a second click or a click elsewhere. The 1.12, 2.4.3 and
  3.3.5 clients have no such menu, and there the player draws its own with the same
  behaviours and a background of its own. It asked for the backdrop template and never set a
  backdrop, so its entries read as text floating over the game world.
- The settings layout is shared with Spoken Quests and Spoken Zones, so the three panels
  read alike.
- The settings panel keeps one rhythm. Every row used to place itself by adding a
  hand-tuned offset, so no two sections were spaced alike; one layout owns the spacing
  now. The links to each addon's own settings have a section of their own instead of
  trailing the minimap ones.
- The settings category is "Spoken Player", and the window's settings are headed as such
  rather than by "Up next", the queue window's own title.
- The player scale slider is visible. It was built without a height, so it drew nothing
  and left a gap on the panel where the setting should have been.
- Every sound setting lives here: the channel everything speaks on, and silencing the
  game's own NPC dialogue while a line is read. Each feature addon used to carry its own
  channel control, so a player with both had two settings for one thing.
- 2.4.3 and 3.3.5 gain rows for the music-channel playback those clients need, and for the
  HD model patch. Both settings existed from the start with no way to reach them.
- Settings under Spoken Player; the frame's position, scale and lock, the minimap button and the sound channel migrate from either old addon on first login.
