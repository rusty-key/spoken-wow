# Interface packs

An interface pack is an addon that brings Spoken's own words, its windows, menus and settings, in a
language. It is for a language no game client runs in, such as Polish, kept by its own translators
outside Spoken. Spoken shows it wherever its language is the player's **Interface Language**, a
setting in the Language section of Spoken's page.

The Interface Language also offers every language a game client runs in that the client's fonts
draw, from the translations Spoken ships: a German interface on an English client needs no pack.
The setting is account-wide and takes effect after a reload.

A pack's strings lie over a built-in language: the client's, or the one the player chose where a
client runs in it. A string the pack lacks shows in that language, then in English, so a pack can
be shipped while it is still partly translated.

The words of quests, books, bosses and places are a text pack's ([`TEXT-PACKS.md`](TEXT-PACKS.md)).
One addon can be both: give its `.toc` both sets of keys.

## The .toc

```
## Title: Spoken Polish Interface
## Version: 1.0.0
## Dependencies: Spoken
## LoadOnDemand: 1
## X-Spoken-Interface: plPL
## X-Spoken-InterfaceFormat: 1
## X-Spoken-LanguageName: Polish
## X-Spoken-LanguageNative: Polski

Interface.lua
```

| Key | What it is |
| --- | --- |
| `X-Spoken-Interface` | The language, a code of the form `xxYY`. |
| `X-Spoken-InterfaceFormat` | `1`. Spoken skips a pack whose format it cannot read. |
| `X-Spoken-LanguageName`, `X-Spoken-LanguageNative` | As for a voice pack ([`community/README.md`](../../community/README.md)). Spoken offers a language only where the game's own font draws its native name, as the interface has no font of its own to fall back on. |

`LoadOnDemand` and `Dependencies: Spoken` are needed. Spoken loads the pack while it loads, before
its modules, and only when the pack's language is the Interface Language.

## Registering the strings

The pack calls `Spoken:RegisterInterfaceStrings(code, module, strings)` once for each module it
translates. `module` is one of `Spoken`, `Quests`, `Places`, `Readables`, `Bosses` and `Developer`.
The keys are the module's own, as in its English strings file:

| Module | English strings |
| --- | --- |
| `Spoken` | `addons/Spoken/Strings.lua` |
| `Quests` | `addons/Spoken_Quests/Strings.lua` |
| `Places`, `Readables`, `Bosses`, `Developer` | `addons/Spoken_<module>/Locale/enUS.lua` |

```lua
Spoken:RegisterInterfaceStrings("plPL", "Spoken", {
    PLAY = "Odtwórz",
    OPT_LANG_AUTO_FMT = "Automatycznie (%1$s)",
})
```

Keep each format argument and its number (`%1$s`, `%2$d`). A language with another word order moves
them, which is why they are numbered. An empty string counts as none.

## Starting and checking

Run these from a checkout of the repository, with `luajit` installed:

```sh
make interface-template LANG=plPL > Interface.lua        # every string, in English, by module
make interface-check LANG=plPL PACK=path/to/YourPack     # what is missing, unknown or misformatted
```

The template is a working pack in English: translate what you can and delete the rest. The check
runs the pack's Lua files as its `.toc` lists them. It fails on a key no module reads, which a
renamed string leaves behind, and on a string whose arguments differ from the English, which would
show wrong. It lists the keys the pack lacks, which show in the language below. Run it after each
Spoken release: a new string shows in the language below until the pack has it.

`/sp settings`, Language: Interface Language lists the pack's language once it is installed.
Choose it and reload. With Spoken > Developer's log on, a pack that does not load or a refused
registration is logged under `interface`.
