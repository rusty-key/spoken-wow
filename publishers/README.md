# Publishers

The description of each project, as markdown, one file per project, for every store the
addons are published on. **Two of them**: CurseForge and Wago Addons, which carry the addons
and the English packs under the same slugs (the language packs and Spoken: English are on
CurseForge alone), and this directory is the source for both sets of pages. It was `curseforge/` while there was only one store, and the frontmatter still names
each store's own project id separately -- `curseforge:` and `wago:` -- because the ids are
the one thing the two do not share.

The frontmatter is everything either submission form asks for besides the body; the body is the
description. Both editors have a Markdown mode — paste `dist/descriptions/<slug>.md` into
CurseForge and `dist/descriptions-wago/<slug>.md` into Wago.

`scripts/descriptions.mjs` reads every directory under `publishers/`, writes the paste-ready
bodies into `dist/descriptions/` and, with their cross-links pointed at Wago, into
`dist/descriptions-wago/`, regenerates any README a page names in `addonReadme`, and
tracks which pages have been pasted:

```
make descriptions              # regenerate
make descriptions-check        # fail if a generated README has drifted (make lint runs this)
make descriptions-published    # record the current pages as pasted, AFTER pasting them
```

Each directory keeps its own `published.json`, and a release prints the pages in its own group
that have moved on since they were last pasted.

ONE BODY, TWO SETS OF LINKS. A page links to its sibling projects, and a link is only right on
the store it is read on: a player on the Wago page for Spoken Places should be offered the Wago
page for its sound pack, not sent somewhere their addon manager cannot install from. The
slugs are identical on both stores, so the Wago copy is the same text with one substitution --
which is why there is one file per project here and not two.

| File | Project | CurseForge id | Wago id | Slug |
| --- | --- | --- | --- | --- |
| `spoken/spoken.md` | Spoken | 1700375 | QN53yXKB | `spoken` |
| `spoken/all.md` | Spoken: English | 1721569 | — | `spoken-english` |
| `spoken/all-<lang>.md` | `Spoken <Language>`, a language's meta addon: Spoken and that language's packs on CurseForge | each page's `curseforge:` | — | `spoken-<language>` |
| `quests/player.md` | Spoken Quests (retired; was VoiceOver Redux) | 1655859 | aN0XPlNj | `spoken-quests` |
| `quests/audio-all.md` | Spoken Quests Audio: All | 1660196 | ANzkpD64 | `spoken-quests-audio-all` |
| `quests/audio-alliance.md` | Spoken Audio: Quests - Alliance | 1660197 | 5NR8mJK3 | `spoken-audio-quests-alliance` |
| `quests/audio-horde.md` | Spoken Audio: Quests - Horde | 1660198 | vNAg3OKo | `spoken-audio-quests-horde` |
| `quests/audio-shared.md` | Spoken Audio: Quests - Shared | 1660199 | QNlz3YKe | `spoken-audio-quests-shared` |
| `quests/audio-gossip.md` | Spoken Audio: Gossip | 1660202 | XKqA45Ky | `spoken-audio-gossip` |
| `quests/audio-<pack>-<lang>.md` | `Spoken <Language> Audio: Quests - <Side>` for Alliance, Horde and Shared, and `Spoken <Language> Audio: Gossip` | each page's `curseforge:` | — | `<language>-spoken-quests-<pack>` |
| `quests/audio-shared-<lang>.md` for itIT, ptBR, koKR, ruRU, zhCN, zhTW | `Spoken <Language> Audio: Quests`, every quest in one pack beside Gossip; Alliance and Horde dormant | each page's `curseforge:` | — | `<language>-spoken-quests` |
| `quests/audio-<lang>.md` | Spoken Quests Audio: `<Language>`, every line in one folder, GitHub only | — | — | — |
| `zones/spoken-zones.md` | Spoken Zones (retired; was ZoneLore) | 1636521 | mNw7b5No | `spoken-zones` |
| `zones/spoken-places-audio.md` | Spoken Audio: Places and Bosses, which carries the bosses pack | 1636532 | b6mvD9KP | `spoken-audio-places` |
| `bosses/spoken-bosses-audio.md` | Spoken Audio: Bosses, inside Spoken Audio: Places and Bosses on CurseForge (`bundledIn:`) | — | — | `spoken-audio-bosses` (not a project) |
| `zones/spoken-places-audio-dede.md` | Spoken German Audio: Places | 1713131 | — | `spoken-german-audio-places` |
| `zones/spoken-places-audio-eses.md` | Spoken Spanish (EU) Audio: Places | 1712807 | — | `spoken-spanish-eu-audio-places` |
| `zones/spoken-places-audio-esmx.md` | Spoken Spanish (AL) Audio: Places | 1711067 | — | `spoken-spanish-al-audio-places` |
| `zones/spoken-places-audio-frfr.md` | Spoken French Audio: Places | 1713125 | — | `spoken-french-audio-places` |
| `zones/spoken-places-audio-kokr.md` | Spoken Korean Audio: Places | 1723252 | — | `spoken-korean-audio-places` |
| `zones/spoken-places-audio-ptbr.md` | Spoken Portuguese Audio: Places | 1713138 | — | `spoken-portuguese-audio-places` |
| `zones/spoken-places-audio-ruru.md` | Spoken Russian Audio: Places | 1713143 | — | `spoken-russian-audio-places` |
| `zones/spoken-places-audio-zhcn.md` | Spoken Chinese (Simplified) Audio: Places | 1723273 | — | `spoken-chinese-simplified-audio-places` |
| `zones/spoken-places-audio-zhtw.md` | Spoken Chinese (Traditional) Audio: Places | 1723276 | — | `spoken-chinese-traditional-audio-places` |
| `books/spoken-books.md` | Spoken Books (retired) | 1701514 | qGYZnRNg | `spoken-books` |
| `books/spoken-readables-audio.md` | Spoken Audio: Readables | 1701520 | qGZOrvNd | `spoken-audio-readables` |
| `books/spoken-readables-audio-dede.md` | Spoken German Audio: Readables | 1723279 | — | `spoken-german-audio-readables` |
| `books/spoken-readables-audio-eses.md` | Spoken Spanish (EU) Audio: Readables | 1723280 | — | `spoken-spanish-eu-audio-readables` |
| `books/spoken-readables-audio-esmx.md` | Spoken Spanish (AL) Audio: Readables | 1723282 | — | `spoken-spanish-al-audio-readables` |
| `books/spoken-readables-audio-frfr.md` | Spoken French Audio: Readables | 1723284 | — | `spoken-french-audio-readables` |
| `books/spoken-readables-audio-ruru.md` | Spoken Russian Audio: Readables | 1723285 | — | `spoken-russian-audio-readables` |
| `books/spoken-readables-audio-ptbr.md` | Spoken Portuguese Audio: Readables | 1723287 | — | `spoken-portuguese-audio-readables` |
| `books/spoken-readables-audio-kokr.md` | Spoken Korean Audio: Readables | 1723288 | — | `spoken-korean-audio-readables` |
| `books/spoken-readables-audio-zhcn.md` | Spoken Chinese (Simplified) Audio: Readables | 1723289 | — | `spoken-chinese-simplified-audio-readables` |
| `books/spoken-readables-audio-zhtw.md` | Spoken Chinese (Traditional) Audio: Readables | 1723295 | — | `spoken-chinese-traditional-audio-readables` |

**A sound pack's page is also its registry entry.** `section:` (quests, zones or books), `lang:`
and, on a quests pack, `pack:` say which pack it is; a language other than English also carries
`version:`, since its folder is staged at build time and has no committed `.toc`.
`scripts/lib/packs.mjs` reads them, derives the folder (English's name, plus `_<lang>`) and the
release tag (English's, plus `-<lang>`), and every build and release script asks it rather than
keeping a table of its own. Adding a language's pack is its page -- one per pack, four for quests
-- plus the CurseForge project it names.

**A pack can live inside another's CurseForge project.** The English bosses pack has no project
of its own: its page says `bundledIn: spoken-audio-places`, and CurseForge's Spoken Audio: Places
and Bosses is sent a zip carrying its `SpokenBossesAudio` folder beside `SpokenPlacesAudio`.
Players sent to CurseForge for it go there. Its page keeps its slug so its README is still
written, but nothing uploads it to CurseForge on its own. On GitHub the two stay apart:
`places-audio` holds Places only and `bosses-audio` the bosses pack, and the manager installs them
as separate products.

**A language with few players yet ships two quests packs, not four.** Its Shared page says
`holds: quests` and carries every quest line, both sides' included, under the name
`Spoken <Language> Audio: Quests`; its Alliance and Horde pages say `dormant: true`, keep their project
ids, and nothing builds or uploads them. Splitting the language later is dropping both keys and
renaming Shared back: its players keep the folder and add their side. Italian, Portuguese,
Korean, Russian and both Chinese ship this way.

The slugs follow the projects' names: lowercased, with the colon, the dash and the brackets
dropped, so `Spoken German Audio: Quests - Horde` is `spoken-german-audio-quests-horde`. A Shared
page that holds every quest is the one exception: it is named `... Audio: Quests` but keeps the
`-quests-shared` slug, so splitting the language later renames the project without moving it.
`spoken-quests-audio-all` and the retired projects keep the slugs they were published under.

**Gossip has no project of its own.** It is a part of Spoken Quests, in Spoken's zip, and its
voices are the Gossip pack above, which every language's quests pack also holds.

**Three projects are retired and keep a page.** `quests/player.md`, `zones/spoken-zones.md` and
`books/spoken-books.md` tell a visitor to install Spoken instead. Nothing uploads to them
again.

**Six more projects exist and are retired.** 1655867, 1658236, 1658237, 1658239 and 1658235 held
the second set of quest packs, back when the audio shipped at two qualities, and 1636548 the
64 kbps zones pack. They stay published so that
an existing install keeps working, and nothing uploads to them again: they have no id in
`scripts/quests/release.sh`, no description file here, and no row above. The ids are written down
only so that the next person to find them knows they are retired rather than missing.

**Renames keep the id, the download count and the file history**; only the name changes, and the
old slug keeps redirecting once the slug is changed too. So the rename to Spoken was done by
renaming the existing projects in the web UI, never by creating replacements - which is also why
the ids above are the ones the projects have always had.

**The old names stay searchable on purpose.** CurseForge has no keywords field: search matches the
project name and the summary, so "VoiceOver Redux" is findable only because each summary says
*Formerly VoiceOver Redux*. That clause is the one place an old name belongs. Everywhere else -
prose, headings, comments, new identifiers - it reads as a name the project still uses.

**Spoken is the project everything else depends on**, and it had to exist *and be
approved* before any upload could name it: the errorCode 1018 gate below. It was created first
for that reason and its id is in `target_curseforge()` in `scripts/quests/release.sh`, whose
`spoken` target `scripts/spoken/release.sh` (`make release-spoken`) runs. Every Spoken addon
declares it in `relations`, which is what makes addon managers install it.

`audio-all` is the odd one: that project ships a **meta addon** rather than audio, because the
complete pack is too big to upload. It is a few kilobytes declaring Spoken and the four packs as required
dependencies, which `scripts/quests/release.sh` sends as part of the upload metadata - relations are
per file, so they need no web-UI step and cannot drift from the file that shipped.

**A dependency has to be an approved project**, which is a one-time gate rather than a
per-release one. A newly created project sits at status "New" until moderation clears it, and
until then an upload naming it in `relations` is rejected with errorCode 1018 ("does not exist,
is not accessible"). Once approved it stays approved, and every later `audio-all` upload
resolves immediately - file moderation is separate and does not gate relations, which is why
the four packs uploaded fine while their own projects were still pending.

`scripts/quests/release.sh` uploads `audio-all` last for the same reason: its dependencies are resolved at
upload time, so it goes after the things it depends on.

The slugs are what the pages and the addon link to, so they are read off the live projects
rather than guessed. They were all changed when the projects were renamed; the old ones redirect, but a redirect is not something to
depend on, and CurseForge resolves a `relations` slug at upload time. `scripts/quests/release.sh`
carries the same slugs in `target_dependencies()`, `Spoken_Quests/DataModules.lua` the same URLs,
and `.github/workflows/release-addons.yaml` the same links, so a slug that changes has to change
in all four. The project names are the addons' `## Title` too (`pack_title` in
`pipelines/quests/tts_cli/factions.py`), so a player sees the same name in the AddOns list as on
the site.

**The folder names moved with them.** The packs ship as `SpokenQuestsAudio*` and the zones pack as
`SpokenPlacesAudio`, where they were `VoiceOverReduxHQAudio*` and `ZoneLoreAudio`. A renamed folder
is a re-download of every clip in it, which the release doing the renaming costs anyway; what it
is not is a broken path, because nothing stores one built from a folder name.

**The sound packs are not on Wago, and not by choice.** Wago's version endpoint sits behind
Cloudflare, which refuses a body of a few hundred megabytes with a 413 before Wago sees it --
the same wall the complete quests pack meets on CurseForge. Every pack is 280-452 MB, so
`scripts/*/release.sh` uploads the addons to both stores and the packs to CurseForge alone.
The Wago ids for the pack projects are listed above anyway: the projects exist, and the day
that endpoint takes a larger file they are what it uploads to.
A language's pack -- Spoken Spanish (AL) Audio: Places is the first -- has no Wago project at all:
its page leaves `wago:` out, `scripts/descriptions.mjs` writes no Wago copy of it, and
`scripts/places/release.sh` skips the Wago upload for it.

**So the packs have a third channel**, `scripts/audio-github-release.sh` (`make audio-release`),
one GitHub release per pack under `<pack>/vX.Y.Z` — the ceiling there is 2 GB a file. It runs
from the machine that built the audio rather than in CI, because the audio is outside git and
no runner can rebuild it. A pack page's `release:` line names its tag prefix, and that is what
makes the Wago copy of every page linking that pack point at the GitHub releases for it
instead of at a Wago project holding no files. The link is the releases query rather than a
tag, so it survives the next audio build.

**English quests are one download on GitHub and four on CurseForge -- the same four folders
either way.** GitHub takes a file up to 2 GB, so there, as for every language, one download is
the whole answer: `SpokenQuestsAudioAll-<version>.zip`, tagged `quests-audio/vX.Y.Z`. It is a
bundle rather than a fifth pack: inside are `SpokenQuestsAudioAlliance`, `...Horde`, `...Shared`
and `...Gossip`, exactly as CurseForge installs them, so a player who moves between the stores
overwrites the same folders instead of holding every line twice. CurseForge cannot take that
file, so it keeps the four split packs and the meta addon that pulls them in.
`quests/audio-all.md` is therefore both: the meta addon's project page, and the registry entry
for the bundle (`pack: all`, `release: quests-audio`; `scripts/lib/packs.mjs` names its folders
under `bundles`). The four split pages say `github: false`, which keeps them out of
`scripts/audio-github-release.sh`. The zip is not called `SpokenQuestsAudio-<version>.zip`
because that is the meta addon's.

**These are pasted by hand and the site is the live copy.** There is no API for descriptions —
`release.sh` uploads files and nothing else, deliberately, because a script that rewrote project
pages each release could quietly undo an edit made in the web UI. So these files are the source
to edit and re-paste, and `published.json` records what you say you pasted rather than anything
read back off the site.

The Wago project id is the `wago:` line in the same frontmatter, eight alphanumeric characters
off the project's entry in <https://addons.wago.io/developers>. `scripts/descriptions.mjs`
checks its shape and the release scripts carry the same ids in `target_wago()`, so an id that
changes has to change in both -- the same arrangement, and the same hazard, as the CurseForge
ids beside them.

The summary — the one-line preview, separate from the description — is the `summary:` line in
each page's frontmatter, where the 255-character limit is checked. It used to be listed here,
which meant two places to edit and one of them silently authoritative.

**No sizes and no line counts in the text.** Both move every time a pack is rebuilt or a line
re-recorded, and a number in prose nothing checks is a number that goes stale on the site while
looking authoritative. CurseForge shows the file size on the Files tab anyway.

The five English quests pages (`audio-all` and the four split packs) carry the same table of the
five packs, with the row for that page marked and the other four linked.
