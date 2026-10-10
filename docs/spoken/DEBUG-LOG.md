# Debug log

**Spoken Developer** (`addons/Spoken_Developer`, a download of its own) keeps a log of what
Spoken plays and why: every line queued, started, stopped, dropped or refused, with the time and
the reason, Spoken's diagnostics, and whatever its modules add (Spoken Quests writes each quest
or gossip window it saw and what it decided). It is for finding out afterwards why a line played
late, twice or not at all, and it is what to send with a report. It is written to be read by a
person, or by an AI agent on the player's computer straight from the saved file.

Spoken itself keeps no log and draws no Developer page: it offers the module a place to register
(`addons/Spoken/Developer.lua`) and forwards to it. Without the module, every call below does
nothing, and `/spoken log` says the module is not installed.

The log is **on as soon as the module is installed**: the module is installed on purpose, by
whoever wants a log. It can be turned off, and keeps nothing while off:

- **Spoken > Developer > Enable Debug Log Recording**, in the game's settings.
- The switch at the bottom of the welcome window (Spoken > General > Show Welcome Window).
- Right-click any **Report a Problem** or **Contribute** button: with the log off, the menu offers to turn it on.
- `/spoken log off` and `/spoken log on`.

## The menu

Right-click a **Report a Problem** button (the windows', the subtitle's, the quest log's, and any
made with `Spoken:CreateRoundButton`) or a Spoken Quests **Contribute** button (the quest or
gossip window's, the quest log's), up exactly when a line did not play: with the log on, a menu
says how big the log is (lines used of 2000, and the room they take in the saved file) and offers

- **Copy the Debug Log**: the diagnostics, then the whole log, in a box, selected: the game has
  no clipboard, so Ctrl+A, then Ctrl+C. To send with a report.
- **Write the Debug Log for an AI Agent**: see below.

The Developer page has the same two buttons and the size, and `/spoken log copy` and
`/spoken log write` do the same from chat. Opened from a button on DialogueUI's window, which
hides the rest of the interface, the menu and the box show over that window.

## Writing it for an AI agent

An addon cannot write a file: the game writes its saved variables, the log among them, only at a
reload, a logout or exit, and no addon can make it write them at another time. The established
debug loggers (Transcriptor, BugGrabber) live with the same rule and ask for a `/reload`. So
**Write the Debug Log for an AI Agent**:

1. writes the detailed diagnostics of the moment into the log (a `diag written for an AI agent:`
   block: the window and the quest open, what Spoken Quests would read for it, Read
   Automatically, the queue entry by entry), then `session written for an AI agent at <wall
   clock>`;
2. has the interface reload, so the game writes `Spoken_Developer.lua`. Forever refuses an
   addon's own reload (`C_UI.Reload`) even inside a click ("Interface action failed because of an
   AddOn"), but not the game's `/reload`: the Write buttons are covered, while the pointer is on
   them, by a secure button whose click runs the macro `/reload`, its PreClick taking the
   snapshot first;
3. after the reload, says in chat that the log is written, with its size.

An AI agent on the same computer then reads the file (below) without asking for anything.

**How to use it.** When a line did not play, keep the quest open, right-click its **Contribute**
or **Report a Problem** button and choose **Write the Debug Log for an AI Agent**. Once the
interface has reloaded, ask the agent (Claude Code, for one, started in a checkout of this repo),
for example:

> The voice-over did not play for the quest I just opened. Read the Spoken debug log and tell me
> why.

For an agent that cannot read this computer's files (a chat in the browser), choose **Copy the
Debug Log** instead (**Copy with Diagnostics** on the Developer page), press Ctrl+C and paste it
into the agent's window with the question: the copy holds the diagnostics and the whole log,
the detailed snapshot of the moment included.

Other questions it answers the same way: "Which quest did I have open?", "What was in the queue,
and from which screens?", "Was Read Automatically on?". The Developer page says the same under
its buttons, in the player's language.
`/spoken log write`, and a Write button the secure button cannot cover, take the snapshot and open
the chat box with `/reload` typed in: Enter writes it. Not in combat, where the interface cannot
reload.

The snapshot says what the screen shows as well as what the game answers (`on screen: NPC quest
frame shown, detail panel, quest "...", NPC "..."; quest log hidden; gossip frame hidden`, the
quest title placed in whichever window shows it, and the last window Spoken Quests read): on
Forever the game's quest functions can answer that no quest is open while its window shows one.
It also says which of Spoken's modules are loaded, turned off in the AddOns list or not installed,
and what the reading window holds (`reading window: open, a book "...", page 2, starting "...";
nothing of Spoken reads it: Spoken_Books is not installed`) and the mailbox's open letter: a book
read without Spoken Books is silent and shows nothing, and this is where the log says why.

## Diagnostics in the log

What `/spoken diagnostics` and each module's own diagnostics say is also written into the log, as
`diag` lines: at login (three seconds after entering the world, once the voice packs are loaded),
when the log is turned on, at each copy and each Write, and on `/spoken log diag`. They are the
detailed ones (Read Automatically, the window open, the queue entry by entry), so the saved file
says how things stood as well as what happened.

## Reading it

- `/spoken log` opens it in the box. `/spoken log 200` shows the newest 200 lines. **Show the
  Log** on the Developer page does the same.
- Written (above), or after a `/reload` or logout, it is also in
  `WTF\Account\<account>\SavedVariables\Spoken_Developer.lua`, under `SpokenDeveloperDB.lines`.
- `/spoken log clear` (or **Clear the Log**) empties it, so what follows reads as a test session
  of its own. `/spoken diagnostics` says whether it is on, how long it is and its size.

It keeps the newest 2000 lines, account-wide: about 150 KB when full.

## For an AI agent on the player's computer

When a player says something like "the audio did not play for the quest I just opened", an agent
with access to their files does not need a copy: the log is in the game's saved variables.

1. Ask the player to right-click a Report or Contribute button > **Write the Debug Log for an AI
   Agent** (or `/spoken log write`), with the quest still open if it is about one. The game
   writes saved variables only at a reload, a logout or exit; this takes the snapshot, then
   reloads.
2. Run `python scripts/developer/read-log.py` (lupa: `pip install lupa`). It finds the newest
   `Spoken_Developer.lua` under the client's `WTF\Account`, merges any other player's logs Spoken
   Party Sync collected (their lines within this log's time; a collection from another session is
   left out), says when it was last written for an agent, and prints that Write's `diag` block
   (the last block of any kind without one), then the newest 300 lines. `--since
   "<quest title>"` starts at the last line naming it; `--grep "quests|player"` narrows it;
   `--wtf` points at another client; `--file` at one file.
3. Read the `quests` lines for the window (the event, the quest ID, then `queued` or the stage
   that stopped it, such as `data-lookup-failed` with its reason or `autoplay-off`), then the
   `player` lines (queued, started, refused, dropped, held), and the `diag` block for how things
   stood (Read Automatically, the packs loaded, the sound settings). Each `quests queued:` line,
   and each `queue N:` line of a snapshot, says where the line came from: `from the NPC's quest
   window (the offer), read automatically (...)`, `..., asked for with dialog Play button`,
   `from the quest log's Play button`, `from /spq test`.

If the script says the log is off, nothing was recorded: ask the player to turn on Keep a Debug
Log and try the quest again.

## What a line says

Each line is `<GetTime> <category> <text>`:

```
1234.567 session start: Tata Throwaway, Spoken 3.0.1, Spoken Developer 0.1.0, client 1.60.1 build 70205
1234.567 session wall clock 2026-10-06 21:14:03 at GetTime 1234.567
1234.567 session modules: quests (Spoken_Quests), zones (Spoken_Zones)
1237.570 diag login:
1237.570 diag   Spoken 3.0.1, API 1, 0 queued, playing
1240.090 quests quest-detail: QUEST_DETAIL raw quest ID 783, title "A Threat Within", NPC "Marshal McBride"
1240.102 quests queued: Queued A Threat Within (...83-accept.ogg), from the NPC's quest window (the offer), read automatically (automatic GetQuestID timer)
1240.102 player queued 783-accept [quests], 1 in queue, A Threat Within
1240.102 player started 783-accept [quests], length 12.4
1252.503 player finished 783-accept [quests]
```

The box and the copies merge logs handed in (another computer's, collected by Spoken Party Sync)
on this client's clock, and head each line with whose it is.

- `session`: the log turned on, a login, the log cleared, with the client build and the wall
  clock that goes with that `GetTime()`, so two computers' logs can be laid side by side.
- `diag`: a snapshot of the diagnostics (above).
- `player`: Spoken's queue as it reports it to every addon (`CLIP_QUEUED`, `CLIP_STARTED`,
  `CLIP_STOPPED`, `CLIP_DROPPED`, the queue stopped or playing again), the lines a source's
  `Enqueue` or `PlayNow` refused without a callback (a duplicate, a file the probe did not find, a
  muted channel, a module turned off), and the Dialog channel muted or restored.
- `screen`: the reading window (books, plaques, signs, letters) as each page shows, with its
  title, page, author for a letter and first words, and whether Spoken Books is there to read it;
  then its closing.
- Other categories come from the modules that write them: `quests` from Spoken Quests, `sync`,
  `msg`, `party`, `room` and `logs` from Spoken Party Sync.

## For feature addons

Additive API on `Spoken`, so `API_VERSION` stays 1: guard on the method.

| Call | What it does |
|---|---|
| `Spoken:HasLog()` | Whether the module is installed. |
| `Spoken:Log(category, message, a, b, c, d)` | One line while the log is on; `message` is a format string when arguments follow (four at most: format a longer line yourself). `category` is a short word of your own. |
| `Spoken:IsLogOn()`, `Spoken:SetLogOn(on)` | Whether it is on; turn it on or off. |
| `Spoken:LogLines(count)` | A copy of the newest `count` lines (all without a count), oldest first. |
| `Spoken:ClearLog(how)` | Empty it and every log handed in; it restarts with a session line saying `how`. |
| `Spoken:ShowLog(count)` | The box. Returns how many lines it shows. |
| `Spoken:AddLogSource(list, clear)` | Logs to read beside this one, such as other computers'. `list()` returns `{ { name, lines, offset }, ... }`, lines written as the log writes them, on their own clock, `offset` the seconds that put them on this one. `clear()` drops them when the log is cleared. |
| `Spoken:AddDiagnostics(name, fn)` | `fn(detailed)` returns a list of lines: what your own diagnostics command says, and with `detailed` what an AI agent needs besides. Shown under `name` in the copies and the `diag` snapshots. |
| `Spoken:AddDeveloperSettings(build)` | A section of your own on the Developer page; `build(layout)` adds rows to its SpokenLayout and may return a function for the page's Defaults. |
| `Spoken:ShowLogMenu(anchor)`, `Spoken:LogMenuHint()` | The Report menu, for a Report button Spoken did not make; the line its tooltip adds. Buttons made with `Spoken:CreateRoundButton(parent, "report")` have it already. |

The module registers with `Spoken:RegisterDeveloper(provider)`; `addons/Spoken/Developer.lua`
lists what the provider holds.
