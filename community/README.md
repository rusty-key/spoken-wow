# Community voice packs

Players make voice packs for Spoken and share them on [spoken.quest](https://spoken.quest/packs). The
Spoken Manager reads the approved packs from the site and shows each one on its Community page, where a
player can install, update and remove it. The authors of Spoken do not make these packs and do not
check what is inside them. A pack carries Lua files, so install only packs from people you trust.

## Share your pack

1. Sign up at [spoken.quest](https://spoken.quest).
2. Upload the zip as an asset of a GitHub release in your own repository. Then open
   [My packs](https://spoken.quest/packs), choose New pack and fill in the form: the asset's address,
   the zip's size in bytes and its SHA-256 checksum (see below), and the other fields.
3. Wait for review. An admin approves or rejects each new pack and each new version, and you get an
   email with the decision. Players see the pack in the Manager once it is approved.
4. To update the pack, upload the new zip as a new release asset and submit a new version on My packs.
   Only one submission can wait per pack. You can withdraw it while it waits.

Until a new version is approved, players keep the last approved one. A rejected version does not
replace it.

## The form

| Field | Rule |
| --- | --- |
| Pack id | Lower-case letters and digits, with single hyphens between words. At most 48 characters. It names the pack's folder and cannot change. |
| Language | A language code of the form `xxYY`: two lower-case letters, then two upper-case ones, such as `deDE`, `itIT` or `heIL`. |
| Section | `quests`, `places` or `readables`. |
| Title, Author | Plain text, 1 to 80 characters. |
| Description | Plain text, 1 to 400 characters. |
| Version | A version such as `1.0.0` or `1.1.0-beta.1`, without spaces, at most 40 characters. Each new version must be higher than the live one, so installed copies show an update. |
| Size in bytes | The size of the zip as a whole number, above 0 and at most 8 GiB. |
| SHA-256 checksum | The SHA-256 checksum of the zip, 64 hex digits. The Manager refuses a download that does not match. |
| Zip link | A GitHub release asset: `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.zip`. At most 500 characters. Each new version needs a new link and a new checksum. |
| Homepage | Optional. An https link to a page about the pack, at most 300 characters. |
| License | Optional. The license as you state it, up to 60 characters. |

The pack id, language and section are fixed once the pack exists. A pack in another language is
another pack with its own id. The Manager drops a pack that breaks a rule, so the form checks them
before it accepts a submission.

`community/packs.json` is frozen. It stays only for Managers up to 0.1.13, which still read it; new
packs are not added there.

## What the zip must contain

- One folder at the root of the zip, named `SpokenCommunity_<id>`. For a pack with the id `elune-quests-de` it is
  `SpokenCommunity_elune-quests-de`. Nothing else may be in the zip: no other folder and no loose files.
- A file `SpokenCommunity_<id>.toc` inside that folder, so the game can read it as an add-on.
- Forward slashes in the paths, no `..` and no absolute paths. The manager refuses a zip that has them.
- Your own work, or work you have the right to share. Say how it may be used in the license field.

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
| `X-Spoken-LanguageFont` | A font file inside your pack, as a path from the pack's folder. Spoken draws the language's name in its menus and its lore pages with it. A clip's text uses the font the clip sets in `present.font`. |

Spoken knows the names of the languages a game client runs in (`enUS`, `deDE`, `esES`, `esMX`, `frFR`,
`ptBR`, `ruRU`, `koKR`, `zhCN`, `zhTW`); every other language takes its names from the first pack that
gives them.

A places pack that ships lore text adds `X-SpokenPlaces-Lore: 1` and registers the text with
`SpokenPlaces:RegisterLoreData(code, kind, data)`. A pack with lore and no voice clips (no
`Sounds.lua`) still needs `X-SpokenPlaces-Language: <code>` in its `.toc`: Places accepts the text
only for a language an installed pack declares with that key. Spoken offers the lore only after it
has checked that the language's name draws, so a lore pack must set `X-Spoken-LanguageNative`, and
one in a script the game's fonts lack, such as Hebrew, must also set `X-Spoken-LanguageFont`.

Right-to-left text is the pack's job: ship the text in visual order.

The Manager's community list takes quests, places and readables packs only, so a
bosses pack cannot be listed there yet.

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

Copy the 64 hex digits into the checksum field. The size in bytes is shown by `dir` on Windows and by
`stat -c %s <file>` on Linux. Use the address of the release asset as the zip link.
