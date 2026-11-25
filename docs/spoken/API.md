# Spoken's API for other addons

Spoken puts one global, `Spoken`, for other addons to call. This page is the reference for an
author whose addon is not part of Spoken: a quest log with a Play button, a dialogue window that
marks the words being read, a text pack, a tool that collects debug logs. The code is
`addons/Spoken/API.lua`.

## Two tiers

**Public** functions are a contract. Any addon may call them. Each one's doc comment in `API.lua`
starts with `Public.`, and `tests/lua/api_contract_test.lua` holds the set to the list on this
page.

**Module** functions are everything else on `Spoken`: about 120 functions that Spoken's own
modules (Spoken Quests, Places, Readables, Bosses and Developer) use to reach the player. They
ship and version with Spoken and may change in any release. Some are documented in a section's
own README because that module uses them, which does not make them a contract. If your addon
needs one, [ask for it to be made Public](https://github.com/rusty-key/spoken-wow/issues/new?template=api-request.yml)
instead of calling it. The same form asks for a function or event the API lacks.

### The promise

- A Public function is never removed or renamed, and never changes what it accepts or returns
  in a way that breaks a caller written against this page.
- A Public event keeps its name and its payload. A later release may add a value after the
  documented ones.
- When a Public function has to go, it is deprecated: this page says so and names what replaces
  it, and the old name keeps working, as a shim over the new one, for as long as the major
  version stays 1.
- New Public functions and events are added without moving `API_VERSION`.

### Detecting Spoken and its features

```lua
if not (Spoken and Spoken.IsCompatible and Spoken:IsCompatible(1)) then return end
```

`Spoken.API_VERSION` is the frozen major. It is 1, and moves only if a Public function had to
break, which the policy above rules out. `Spoken:IsCompatible(required)` is true where
`required` is a number no greater than it.

Everything added after the first release is guarded on the field, not on a version:

```lua
if Spoken.PlayStory then
    -- this Spoken has stories
end
```

A player with an older Spoken then sees your addon without the feature rather than an error.

`Spoken:Supports(feature)` names features too, for a Spoken that has it
(`if Spoken.Supports and Spoken:Supports("story:boss") then`). It answers true for:

| `feature` | |
|---|---|
| `"story:<kind>"` | A kind of story whose module is installed and has registered: `"story:instance"`, `"story:boss"`, `"story:quest"`. |
| `"stories"`, `"captions"`, `"callbacks"`, `"log"`, `"narrators"`, `"text-packs"`, `"interface-packs"` | The sections of this page. |

and false for anything else, a name it does not know included. `"log"` means the log calls
exist; `HasLog()` says whether the log does, with Spoken Developer installed. A name, once listed, is never
taken away.

### Mistakes

A registration with the wrong kind of value (`RegisterCallback`, `AddLogSource`,
`AddDiagnostics`) raises an error at your line, so you find it while writing the addon rather
than when Spoken later calls what you handed it. A query with the wrong kind of value answers
false or nil and never raises. `RegisterText` and `RegisterInterfaceStrings` are the exception:
they answer false, so a pack never breaks a login.

### Tables Spoken hands out

`GetCaption`, `GetNowPlaying` and the events hand you Spoken's own tables, the same ones the
queue and the captions use, because they are read every frame or compared by identity. Read
them and never change them. `SplitCaption` and `CaptionWords` return new tables, yours to keep.
`Spoken.ADDON_VERSION` is Spoken's release (`"3.13.1"`), for a log line; never compare it to
decide what to call.

## Stories

A dungeon's story, a boss's story or a quest's voice-over, for another addon's Play button. Keyed
by the game's own ids, so a caller needs none of Spoken's keys.

| `kind` | `id` | Told by |
|---|---|---|
| `"instance"` | the instance map id, `GetInstanceInfo()`'s 8th value | Spoken Places |
| `"boss"` | the encounter id, `ENCOUNTER_START`'s first argument | Spoken Bosses |
| `"quest"` | the quest id | Spoken Quests |

| Call | Returns |
|---|---|
| `Spoken:HasStory(kind, id)` | `boolean`: whether the story can be played now. |
| `Spoken:PlayStory(kind, id)` | `boolean`: plays it as the Compendium's Play does, at once where nothing speaks, else behind the line speaking. True if it plays or waits. |
| `Spoken:IsPlayingStory(kind, id)` | `boolean`: whether it is speaking, not waiting, held or paused. |
| `Spoken:StopStory(kind, id)` | `boolean`: stops it, speaking or waiting, and leaves every other line alone. True if it was queued. |

Only a voiced story counts, with its module installed and switched on and the story not locked
for this character. A kind whose module is missing, or an `id` that is not a number, answers
false to all four.

No event covers every change to `HasStory`. Ask it as your button shows, and again on
`AUDIO_CHANGED` and `PART_SWITCHED`; a quest's also on the game's `QUEST_ACCEPTED`,
`QUEST_REMOVED` and `QUEST_TURNED_IN`. Spoken Bosses meets a boss in its own `ENCOUNTER_START`
handler, which may run after yours, so ask a frame later.

A boss fight of two bosses plays the first that has a story. A quest plays the first part a pack
voices of its offer, its progress and, once handed in, its hand-in; every part a pack voices
counts as the story for `IsPlayingStory` and `StopStory`. A story played this way is tagged on
its caption (`story` below), so your addon knows the line is its own.

## Captions

For an addon that shows the line being read in its own window and marks the word being spoken,
the way Spoken's captions do.

| Call | Returns |
|---|---|
| `Spoken:GetCaption()` | The caption of the line speaking or paused, or `nil`. |
| `Spoken:GetCaptionOptions()` | `highlight, typewriter, typewriterBy`: the player's Highlight Words, Type Words Out (both false with Show Words off) and Type Out By (`"letter"` or `"word"`), with or without a line. |
| `Spoken:SplitCaption(text)` | `words, totalWeight`: `text` cut into words as the captions cut it, a Chinese character being a word. Escape sequences are kept. `nil` for anything but a string. |
| `Spoken:CaptionWords(transcript)` | The same for the words the captions show: escape sequences removed. A source's `present.timings` lists one time per word of this. |

`GetCaption` stays current while Spoken's captions are hidden or off. Caption views call it every
frame, so it returns **the same table on every call**, and its `clip` and `words` are Spoken's
own. Read them; never change or keep them past the frame.

```lua
caption = {
    clip         = clip,    -- the line, see Clips below
    words        = { word, ... },
    totalWeight  = 12.4,    -- the words' span; the clip's length when `timed`
    progress     = 0.35,    -- share of the recording played, 0 to 1; nil for a clip with no length
    speaking     = true,
    activeWord   = 4,       -- index into words, only while speaking
    timed        = false,   -- the words' times are the recording's own, not an estimate
    highlight    = true,    -- as GetCaptionOptions
    typewriter   = false,
    typewriterBy = "letter",
    story        = { kind = "quest", id = 33 }, -- what PlayStory was asked for when it played this line, else nil
}

word = {
    text   = "Wolves",
    start  = 0.6,           -- where it starts and ends, in units of totalWeight
    finish = 1.92,
    first  = 1,             -- its first and last byte in the clip's text
    last   = 6,
    joined = false,         -- cut from the same run of text as the word before, with no space (Chinese)
}
```

To mark the same words in your own copy of the line, split it with `SplitCaption` and match by
`first`/`last`. Spoken Quests does this inside DialogueUI
([DIALOGUEUI-BRIDGE.md](../quests/DIALOGUEUI-BRIDGE.md)), and [CAPTIONS.md](CAPTIONS.md) says how
the captions time the words.

## The queue

| Call | Returns |
|---|---|
| `Spoken:GetNowPlaying()` | The clip speaking or paused, or `nil`. A line held at the head, waiting on a gate such as combat, makes no sound and is not returned. |
| `Spoken:GetQueueSize()` | `integer`: lines queued, the head included. |
| `Spoken:IsPlaying(clip?)` | `boolean`: whether a line is speaking; with `clip`, whether that one is. |
| `Spoken:IsPaused()` | `boolean`: whether the player paused. It stays paused across a reload. |
| `Spoken:Pause()` | `boolean`: false where already paused. The client has no seek, so the line stops and `Resume` replays it from the start. |
| `Spoken:Resume()` | `boolean`: false where not paused. |
| `Spoken:Skip()` | `boolean`: ends the line at the head, speaking or held, and goes on. False where nothing was skipped, and for a line the client gave no handle to stop, which plays on. |
| `Spoken:Previous()` | `boolean`: replays the line before the current one, or the last line heard once the queue is empty. False where there is none. |
| `Spoken:CanPrevious()` | `boolean`: whether `Previous` has a line to go back to. |
| `Spoken:GetWaitingCount()` | `integer`: lines waiting behind the head. |
| `Spoken:GetHeldReason(clip)` | Why `clip` waits at the head without speaking, such as combat, in the player's language; nil where nothing holds it. |
| `Spoken:StopAll()` | Stops and clears every line of every source, and unpauses. A line speaking that the client gave no handle to stop stays and plays to its end. |

### Clips

A clip is one line in Spoken's queue. `GetNowPlaying`, `GetCaption` and the events hand you
Spoken's own clip tables; read them, never change them. These fields are Public:

| Field | |
|---|---|
| `key` | `string`, unique within its source (`"q:33:accept"`). |
| `source.key` | `"quests"`, `"places"`, `"readables"` or `"bosses"`. |
| `source.title` | The part's name as Spoken's page shows it. |
| `length` | Seconds, or nil. |
| `textOnly` | True for a line with no recording, shown in the narrator for `length`. |
| `present.header` | Who or where: an NPC's name, a place, a book's title. May be nil. |
| `present.label` | What: a quest's title, a subzone, a page. May be nil. |
| `present.transcript` | The words read. May be nil. |
| `present.portrait.creatureID` | The creature speaking, where the line has one. May be nil. |
| `story` | `{ kind, id }` as on the caption. |

Every other field belongs to the module that queued the clip.

## Parts

`Spoken:IsPartOn(key)` is whether the player has the part `key` (`"quests"`, `"places"`,
`"readables"` or `"bosses"`) switched on in Spoken's settings. A part never switched off is on,
whether its module is installed or not, so check `HasStory` before offering a story. Anything
but a string answers false.

## Events

```lua
local handle = Spoken:RegisterCallback("CLIP_STARTED", function(clip) ... end)
Spoken:UnregisterCallback(handle)
```

`RegisterCallback(event, fn)` returns a handle for `UnregisterCallback`, and raises where `event`
is not a string or `fn` not a function. An error in your `fn` is caught and kept for
`/spoken diagnostics`; the other handlers still run. `UnregisterCallback` ignores anything that is
not a handle.

| Event | Payload | When |
|---|---|---|
| `AUDIO_CHANGED` | none | After any change to the queue: coarse, so redraw from the calls above. |
| `CLIP_QUEUED` | `clip` | A line joined the queue. |
| `CLIP_STARTED` | `clip` | A line started speaking. |
| `CLIP_STOPPED` | `clip, finishedPlaying` | A line left the queue through `Skip`, `StopAll` or its module, started or not. `finishedPlaying` is true only for a line that played to its end. |
| `CLIP_DROPPED` | `clip, reason` | Spoken took a queued line out itself, unheard. `reason` is `"queue-limit"`, `"outranked"`, `"missing"` (the client could not play the file), `"refused"`, or a module's own word. |
| `QUEUE_EMPTY` | none | The last line left the queue. |
| `PART_SWITCHED` | `key, on` | The player switched a part on or off in Spoken's settings. |

Spoken fires other events for its modules (`SOURCE_REGISTERED`, `CONTRIBUTE_SETTINGS_CHANGED`,
`REPORT_SETTINGS_CHANGED`, `VOICE_PACKS_LOADED`, `COMPENDIUM_FONT_CHANGED`,
`DEVELOPER_REGISTERED`, `DEVELOPER_SETTINGS_ADDED`). They are Module tier: listed in `API.lua`,
not frozen.

## Narrator styles

A narrator style of your own: a card among Spoken's narrator styles, with your title, description
and picture, and a window your addon draws itself. While it is the style, Spoken shows none of its
own windows and tells yours which line to show. Everything else you read and do through the calls
on this page, so your style keeps working however Spoken's own windows change.

| Call | |
|---|---|
| `Spoken:RegisterNarrator(id, info)` | Adds the style. `info.title` and `info.description` are its card's words, in the player's language; `info.picture`, optional, a texture for the card. `info.Update(clip)` is called whenever the line to show changes: the clip, or nil to show nothing. `info.settings(layout)`, optional, adds a section of rows to Spoken's page, shown while it is the style. Register while your addon loads, so the card is there when the page is built. Raises for a wrong argument, or an `id` that is one of Spoken's own styles. Registering `id` again replaces it. |
| `Spoken:SuggestNarrator(id)` | Asks the player, once ever, whether to switch to your style, whatever style they have now. Not if it is already theirs. At login if you call it before then. Whatever they answer, it never asks again. |

`Update` is told a line only when there is one to show: the line at the head of the queue, unless
the player turned the narrator off for its part, or DialogueUI's dialog covers the screen. While
the player previews your style with nothing playing, it is told a sample line. If `Update` raises,
the line still plays and the error goes to the debug log.

These give your window the parts Spoken's own windows have, drawn and kept current by Spoken:

| Call | |
|---|---|
| `Spoken:ShowCaptions(parent, width)` | Spoken's captions of the line shown, in `parent` from its top left, `width` wide: the player's Word Size, Rows at Once, Highlight Words and Type Words Out, scrolling as the line is read. Returns the height they take, 0 where the line shows no words. Call it on each `Update` and size your window to it. |
| `Spoken:CreateControl(parent, kind)` | One of Spoken's round buttons: `"previous"`, `"stop"` (Stop, then Replay), `"skip"` or `"stopall"`. It acts when clicked, has its tooltip, and greys out while it can do nothing. Anchor it yourself. Raises for another `kind`. |
| `Spoken:CreatePortrait(parent, size)` | Spoken's round portrait. `portrait:SetClip(clip)` shows the line's speaker with the line's badge on the ring, and draws the face again once the game has it. `portrait:SetRingColor(r, g, b)` tints the ring; no colour gives Spoken's back. |
| `Spoken:CreateActions(parent)` | A row for the line's own buttons: Report, and whatever the module that queued the line adds, minus those the player hid. `row:SetClip(clip)` fills it and sizes the row to them. |

The rest of what a window usually needs, all Public:

- **The reading position:** `GetCaption()`, every frame, for a progress bar of your own (`progress`).
- **Who and what:** the clip's `present.header` and `present.label`, and `present.portrait.creatureID`
  for anything of your own about the speaker.
- **Status:** `IsPaused()`, `GetWaitingCount()`, `GetHeldReason(clip)`, and `AUDIO_CHANGED` to
  redraw them.
- **Controls:** `Pause()`, `Resume()`, `Skip()`, `Previous()` with `CanPrevious()`, `StopAll()`.

`settings(layout)` gets the page's layout. These of its methods are part of the contract; build
your rows with them only:

| Method | |
|---|---|
| `layout:Section(title)` | Starts your section. Call it first. |
| `layout:Checkbox(label, tooltip, read, write, apply)` | `read()` gives the value, `write(value)` stores it, then `apply()` runs. |
| `layout:Slider(label, min, max, step, read, write, apply)` | The same, for a number. |
| `layout:Dropdown(label, tooltip, values, read, write, apply, describe)` | One of `values`, a list or a function returning one; `describe(value)` names each. |

If the player removes your addon, Spoken shows its Small Window. Their choice is kept and comes
back with the addon.

## Text packs and interface packs

| Call | Returns |
|---|---|
| `Spoken:RegisterText(code, section, data)` | `boolean`: whether the words were kept. A text pack's words of `section` (`"quests"`, `"readables"`, `"bosses"` or `"places"`) in the language `code`. Kept only where `code` is the player's Text Language; English is never kept. |
| `Spoken:RegisterInterfaceStrings(code, module, strings)` | `boolean`: whether they were kept. An interface pack's strings for `module` (`"Spoken"`, `"Quests"`, `"Places"`, `"Readables"`, `"Bosses"` or `"Developer"`), keyed as that module's English. Kept only where `code` is the session's Interface Language. |

Both return false, and raise nothing, for a value of the wrong kind, so a pack never breaks a
login. What the tables hold is in [TEXT-PACKS.md](../contributors/TEXT-PACKS.md) and
[INTERFACE-PACKS.md](../contributors/INTERFACE-PACKS.md).

## The debug log

Spoken keeps no log itself: Spoken Developer does, when installed. Without it every call here
does nothing and answers false or nil, so an addon may call them unguarded once `Spoken.HasLog`
exists.

| Call | Returns |
|---|---|
| `Spoken:HasLog()` | `boolean`: whether Spoken Developer, and the log with it, is installed. |
| `Spoken:IsLogOn()` | `boolean`: whether the log keeps lines now. |
| `Spoken:Log(category, message, a, b, c, d)` | One line while the log is on. `message` is a format string when arguments follow, four at most; `category` a short word of your own. |
| `Spoken:AddLogSource(list, clear?)` | Logs to read beside this one, such as other computers'. `list()` returns `{ { name, lines, offset }, ... }`: lines as the log writes them, on their own clock, `offset` the seconds that put them on this one. `clear()` drops them when the log is cleared. |
| `Spoken:AddDiagnostics(name, fn)` | `fn(detailed)` returns a list of lines: what your own diagnostics command says, and with `detailed` what an AI agent reading the log needs besides. |

[DEBUG-LOG.md](DEBUG-LOG.md) describes the log and the Module calls Spoken Developer and the
modules use.

## Checks

```sh
make test-player   # runs tests/lua/api_contract_test.lua among the rest
```
