# Community voice packs

This folder lists voice packs that players made for Spoken. The Spoken Manager reads
`community/packs.json` from the `master` branch and shows each entry on its Community page, where a
player can install, update and remove it. The authors of Spoken do not make these packs and do not
check what is inside them. A pack carries Lua files, so install only packs from people you trust.

To add your pack, open a pull request that adds one entry to `packs.json`. A maintainer looks at it
before it is merged.

## The entry

Each entry is an object in the `packs` list. This is an example only. It is not in the json file.

```json
{
  "id": "elune-quests-de",
  "title": "Elune Quests",
  "author": "Elune",
  "description": "Quest text read aloud in German by a team of friends.",
  "lang": "deDE",
  "section": "quests",
  "version": "1.0.0",
  "size": 734003200,
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "url": "https://github.com/your-name/your-pack/releases/download/v1.0.0/SpokenCommunity_elune-quests-de.zip",
  "homepage": "https://example.com/where-you-talk-about-it",
  "license": "CC-BY-4.0",
  "addedAt": "2026-10-18"
}
```

| Field | Rule |
| --- | --- |
| `id` | Lower-case letters and digits, with single hyphens between words. At most 48 characters. Unique in the list. |
| `title`, `author` | Plain text, up to 80 characters. |
| `description` | Plain text, up to 400 characters. |
| `lang` | A language code of the form `xxYY`: two lower-case letters, then two upper-case ones, such as `deDE`, `itIT` or `heIL`. |
| `section` | `quests`, `zones` or `books`. |
| `version` | A version such as `1.0.0` or `1.1.0-beta.1`. Raise it for every new zip, so installed copies show an update. |
| `size` | The size of the zip in bytes, as a whole number. |
| `sha256` | The SHA-256 checksum of the zip, 64 hex digits. Required. The manager refuses a download that does not match. |
| `url` | A GitHub release asset: `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.zip`. |
| `homepage` | Optional. An https link to a page about the pack. |
| `license` | Optional. The license as you state it, up to 60 characters. |
| `addedAt` | The date you added the entry, as `YYYY-MM-DD`. |

An entry that breaks a rule is ignored by the manager, so check the list above before you submit.

## What the zip must contain

- One folder at the root of the zip, named `SpokenCommunity_<id>`. For the example it is
  `SpokenCommunity_elune-quests-de`. Nothing else may be in the zip: no other folder and no loose files.
- A file `SpokenCommunity_<id>.toc` inside that folder, so the game can read it as an add-on.
- Forward slashes in the paths, no `..` and no absolute paths. The manager refuses a zip that has them.
- Your own work, or work you have the right to share. Say how it may be used in `license`.

The manager installs the folder into `Interface\AddOns` and never touches any other folder. It keeps
the previous version in a backup folder until the next install.

Spoken loads a pack by what its `.toc` and its Lua say, not by its folder name, so a community folder
plays like an official one:

- A quests pack is found by the `X-SpokenQuests-DataModule-Version` key in its `.toc`.
- A places pack is one whose `Data/Sounds.lua` registers itself in `SpokenPlacesAudioPacks`, and a
  bosses pack one that registers in `SpokenBossesAudioPacks`. Both read their language from the
  `.toc` key below.
- A readables pack registers itself in `SpokenReadablesAudioPacks`. It names its language with the
  `.toc` key below or, in Lua, as `language` on its pack table.

## Name the language

A pack declares its language in its `.toc`. Spoken lists a language in its menus once a pack for it is
installed, so a language needs no change to Spoken. Use the key of the pack's section:
`X-SpokenQuests-Language`, `X-SpokenPlaces-Language`, `X-SpokenBosses-Language` or
`X-SpokenReadables-Language`. The value is a code of the form `xxYY`. A pack with no key, or a value
that is not a code, is English.

These keys are shared by every section and are optional:

| Key | What it is |
| --- | --- |
| `X-Spoken-LanguageName` | The language's name in English, for lists that cannot draw its own. |
| `X-Spoken-LanguageNative` | The language's name in itself, as the menus show it. |
| `X-Spoken-LanguageFont` | A font file inside your pack, as a path from the pack's folder. Spoken draws the language's name, its lore pages and its clip text with it, unless a clip sets its own font. |

Spoken knows the names of the languages a game client runs in (`enUS`, `deDE`, `esES`, `esMX`, `frFR`,
`ptBR`, `ruRU`, `koKR`, `zhCN`, `zhTW`); every other language takes its names from the first pack that
gives them.

A places pack that ships lore text adds `X-SpokenPlaces-Lore: 1` and registers the text with
`SpokenPlaces:RegisterLoreData(code, kind, data)`. Spoken offers the lore only after it has checked that
the language's name draws, so a lore pack must set `X-Spoken-LanguageNative`, and one in a script the
game's fonts lack, such as Vietnamese, must also set `X-Spoken-LanguageFont`.

Right-to-left text is the pack's job: ship the text in visual order.

A Hebrew places pack with lore, for example:

```
## Title: Spoken Places Hebrew
## Version: 1.0.0
## Group: Spoken
## X-SpokenPlaces-Language: heIL
## X-SpokenPlaces-Lore: 1
## X-Spoken-LanguageName: Hebrew
## X-Spoken-LanguageNative: עברית
## X-Spoken-LanguageFont: Fonts/NotoSansHebrew.ttf
```

## Get the checksum

On Windows, in a terminal, run:

```
certutil -hashfile SpokenCommunity_elune-quests-de.zip SHA256
```

On macOS or Linux, run:

```
sha256sum SpokenCommunity_elune-quests-de.zip
```

Copy the 64 hex digits into `sha256`. The size in bytes is shown by `dir` on Windows and by
`stat -c %s <file>` on Linux. Upload the zip as an asset of a GitHub release in your own repository
before you send the pull request, and use that asset's address as `url`.

## Send it

1. Fork the repository and edit `community/packs.json`. Add your entry to the end of the `packs` list.
2. Keep the file valid JSON: commas between entries, none after the last one.
3. Open a pull request. Say in it what the pack covers (language, section, how much of it).
4. To update your pack later, upload the new zip, then open a pull request that changes `version`,
   `size`, `sha256` and `url` of your entry.
