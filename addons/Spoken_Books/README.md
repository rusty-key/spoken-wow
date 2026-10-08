**Every book in the world, read aloud.** One of [Spoken](https://www.curseforge.com/wow/addons/spoken-player)'s modules: it comes in Spoken's download, beside Spoken Quests and Spoken Zones, and narrates through it.

Open a book and it starts reading. Turn the page and it follows you. Close it and it reads on — shut the book, get back on the road, and hear the rest of it. `/spb stop` when you have heard enough. Letters and notes in your bags work the same way, and so do the plaques and gravestones out in the world.

## What it reads

The tablets in a dungeon, the ledgers in a town hall, the note on a corpse, the tombstone you have walked past a hundred times and never clicked. Some are a single line. Some are journals that run for pages, and those read straight through while you turn them.

- **Whole books, in order** — opening the first page queues the rest, so you read along rather than pressing play again at every turn. `/spb whole` narrates only the page in front of you instead.
- **It follows your page turns** — turn to a page it was already going to read and nothing restarts; jump somewhere else and it picks up from there.
- **Your mail is never read.** The game shows letters and books in the same window, so the addon checks: anything with a sender, or anything opened at your mailbox, stays silent. Your post is yours.
- **Autoplay, on by default** — opening a book is already a deliberate act. Turn it off and nothing starts by itself.
- **A Play button on the book itself** — beside the window, whenever there is something to hear. It is how you read a book with autoplay off, and it turns into Stop while that book is being read.
- **Or hear each book only once** — turn it on and a book you have already heard is not read to you again. What you have read is remembered per character, so an alt walking into the same library hears it fresh, and a button in the settings forgets it all if you want the library back.
- **Or have the book close itself** — turn on *Close Book When Done Reading* and a book, letter or plaque shuts once its last page has been read to you. With DialogueUI's book view, which hides your interface while a book is open, that gives the interface back without pressing X.

## Narration needs the sound pack

The voice audio is a large download, so it ships separately as **[Spoken Books Audio](https://www.curseforge.com/wow/addons/spoken-books-audio)**. Unlike Spoken Zones, this addon has nothing to show you without it — the game already puts the words on your screen — so install both.

Without the pack it loads, stays quiet, and `/spb status` tells you what is missing rather than leaving you guessing.

## Worth knowing

- **A few pages are silent, and always will be.** The game leaves some empty and fills others in as you read them, so there is nothing to record.
- **The words are the ones vanilla shipped.** On WoW: Forever, a book that has been rewritten since will not be recognised, and the addon stays quiet rather than reading you the old version.
- **Some readings still land wrong.** Reports decide what gets re-recorded first.

## When there is no voice

The corpus is built from a 1.12 world database, so it has nothing for a book written after vanilla, for languages that database does not carry, or for custom text a server added itself. Open one of those and the Play button reads **Contribute** instead: press it and it hands you a link carrying the page's own text, copied straight off your screen. Copy it, open it in your browser, and press Send — the same page sent by several readers is what moves a book up the queue. Your mail is never sent this way; the addon still checks for a sender or an open mailbox first. Rather not see the button? **Hide the Contribute buttons** in the Spoken settings turns it off.

The first time you press Contribute, you can also choose to **gather as you play**: every page Spoken has no voice for is kept quietly, and you send them all at once by uploading `SavedVariables/SpokenContributions.lua` at spoken.rusty.one/contribute. `/spoken share` shows the steps again, and **Gather missing lines automatically** in the Spoken settings turns it off.

## Settings

Game Menu → Options → AddOns → **Spoken Books**, or the Spoken minimap button. Everything on the panel is a command as well, so nothing here is out of reach on a client whose settings window will not open.

```
/spb read        read the page in front of you, whatever autoplay says
/spb stop        stop reading
/spb autoplay    read a book as soon as it opens (on by default)
/spb whole       read the whole book, or only the page on screen
/spb once        read each book only once (off by default)
/spb close       close the book once it has been read (off by default)
/spb forget      forget what this character has read, so it is all new again
/spb settings    open the panel
/spb status      what is known, what is narrated, and which pack is doing it
```

`/spokenbooks` is the long form of `/spb`.

## Clients

Classic Era, the Anniversary client, and WoW: Forever. The game's book window is the same on all three, so this is one addon rather than three.
