# Text packs

A text pack is an addon that brings the words of quests, gossip, readables, bosses and places in a
language, with no voice. It is for a language no game client runs in, such as Polish or Ukrainian,
and for translations kept by their own translators outside Spoken. Spoken reads it wherever its
language is the player's **Text Language**, a setting in the Language section of Spoken's page.

The words show in the captions and subtitles, and on the pages of Azeroth's Compendium. They never
change what the game shows or what Spoken matches a line by: that is always the client's own text.
Where a voice pack in the same language has a line, its words win, because they are what the voice
says. Where neither has a line, Spoken shows what it would without a text pack.

## The .toc

```
## Title: Spoken Polish Text
## Version: 1.0.0
## Dependencies: Spoken
## LoadOnDemand: 1
## X-Spoken-Text: plPL
## X-Spoken-TextFormat: 1
## X-Spoken-LanguageName: Polish
## X-Spoken-LanguageNative: Polski

Quests.lua
Readables.lua
Bosses.lua
Places.lua
```

| Key | What it is |
| --- | --- |
| `X-Spoken-Text` | The language, a code of the form `xxYY`. |
| `X-Spoken-TextFormat` | `1`. Spoken skips a pack whose format it cannot read. |
| `X-Spoken-LanguageName`, `X-Spoken-LanguageNative`, `X-Spoken-LanguageFont` | As for a voice pack ([`community/README.md`](../../community/README.md)). Set `X-Spoken-LanguageNative`: Spoken offers a language only once it has checked that its name draws. A language in a script the game's fonts lack also needs `X-Spoken-LanguageFont`. |

`LoadOnDemand` and `Dependencies: Spoken` are needed. Spoken loads the pack while it loads, before
its modules, and only when the pack's language is the Text Language, so a corpus the player does not
read costs no memory. A pack that loads on its own is accepted too, but its tables are parsed for
nothing on every other setting.

English is Spoken's own text, edited on spoken.quest, and a pack of it is refused.

Spoken's own windows and settings are an interface pack's
([`INTERFACE-PACKS.md`](INTERFACE-PACKS.md)). One addon can be both.

A text pack is not a voice pack: it adds no Voice Language and hides no download offer. Changing the
Text Language takes effect after a reload.

## Registering the words

Each file calls `Spoken:RegisterText(code, section, data)` once or more. Calls add to each other,
table by table, so a section can be split across files, and a later call wins on the same key.

```lua
Spoken:RegisterText("plPL", "readables", {
    pages = { [1234] = "Pierwsza strona.", ["n0a1b2c3d-…"] = "Strona z klienta." },
    titles = { [1234] = "Rejestr miasta" },
})
```

The keys are the ids Spoken and its packs already use, so they do not change:

| Section | Kind | Keyed by | Example |
| --- | --- | --- | --- |
| `quests` | `lines` | line id: `q:{questID}:{accept\|progress\|complete}`, with `:w{n}` for another wording; `g:{hash}`, `g:b{id}-{voice}`, `g:{lang}-{hash}` for gossip; `f:{broadcastTextID}:{voice}` for follow-ups and chatter | `["q:783:accept"]` |
| `quests` | `titles` | quest id | `[783]` |
| `readables` | `pages` | the page's id in the readables packs: a page text id, or the minted `n{uuid}` string | `[1234]` |
| `readables` | `titles` | the book's id | `[1234]` |
| `bosses` | `stories`, `names` | instance map, then boss key | `[36]["edwin vancleef"]` |
| `places` | `zones`, `subzones` | as Places' lore tables: `zones[mapID] = { name, short, full }`, `subzones[mapID][key]` | `[1411]` |

A quest or gossip line that English splits by the player's sex takes `:m` and `:f` on its id
(`q:783:accept:m`). Spoken reads the player's own first, then the plain id. Quest text keeps the
game's tokens: `$N` (name), `$C` and `$R` (class and race), `$Gmale:female;` and `$B` are filled in
for the player.

A value is the words as a string, or a table whose first entry is the words:
`{ "Pierwsza strona.", src = "5d41402a" }`. Spoken reads only the words. `src` is for the pack's own
tools: the hash of the English it was translated from, so a change to the English can be found.
An empty string counts as no words.

Places' stories are offered whole: Places reads a language's `places` only where a text pack has
some, and stays on the client's language or English otherwise. The other sections fall back line by
line.

## Checking it

`/sp settings`, Language: Text Language lists the pack's language once the pack is installed and the
fonts can draw it. Choose it and reload. With Spoken > Developer's log on, a refused registration (a
misspelt section or kind, or a language that is not a code) is logged under `texts`.
