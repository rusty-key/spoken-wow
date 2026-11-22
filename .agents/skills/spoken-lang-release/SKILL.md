---
name: spoken-lang-release
description: Use when a language maintainer wants to know which of their Spoken CurseForge audio packs are worth a new release, invoked as /spoken-lang-release <lang> (deDE, frFR, esMX, ...). Compares each pack of that language as the Spoken Manager installed it with the newest file on its CurseForge project, clip by clip, checks the once-a-day limit and prints a table of the packs worth releasing with the command to publish each one. Uploads nothing.
argument-hint: "<lang>"
---

# spoken-lang-release

Finds the packs of one language that changed enough since their last CurseForge file to be worth a
new release, and prints the command that publishes each one. Every release is a full zip of several
hundred MB that every player downloads again, and CurseForge moderation asks for restraint. Small
changes wait for the next release that is worth it.

The skill uploads **nothing** and runs none of the commands it prints. The maintainer runs them.
Never read `spoken-release.env`: it holds the CurseForge token.

## 0. Setup (once per maintainer)

The argument is the language (`deDE`, `frFR`, `esMX`, ...). Without one, ask which.

Settings live in `~/.config/spoken/<lang>/config.json`, shared with `/spoken-lang-daily` (an old
`~/.claude/spoken/<lang>` moves there on the first run). If it is missing, `check.mjs` says so:
copy `.agents/skills/spoken-lang-daily/config.example.json` there and
let the maintainer fill in the `release` part:

| Key | Meaning |
| --- | --- |
| `addonsDir` | The `Interface/AddOns` folder the Spoken Manager installs into |
| `releaseEnv` | Their `spoken-release.env` (default: beside `scripts/maintainers/spoken-release.sh`). It needs `CF_TOKEN` and one `CF_<folder>` per pack, see `spoken-release.env.example` |
| `workDir` | Where changelogs and manual zips go (default `~/.config/spoken/<lang>/release`) |
| `webUpload` | Pack folders too big for the upload API, released through the website (see below) |
| `minClips`, `minShare` | Threshold for a release, default 50 clips or 2 % of the pack |

The packs and their CurseForge projects come from `publishers/*/*-<lang>.md` in this repository,
so a new pack only needs its publisher file.

## 1. Check

The local state is what the Spoken Manager installed. If the Manager is not up to date, the skill
compares an old state. Mention that in the report, do not ask first.

```bash
node .agents/skills/spoken-lang-release/check.mjs --lang <lang> --json
```

Takes about 10 seconds. The script:

- fetches each project's newest **approved** file from `www.curseforge.com/api/v1/mods/<id>/files`
  (no token),
- reads only that zip's table of contents with HTTP range requests and compares every file by path,
  size and CRC-32 with the local folder,
- counts new, changed and removed clips (`.ogg`/`.mp3`/`.wav`) and other files,
- writes an English changelog per changed pack to `<workDir>/notes/<folder>-<version>.md`,
- gives each pack a verdict:

| Verdict | Meaning |
| --- | --- |
| `worth` | at least `minClips` clips or `minShare` of the clips changed, and the version is higher |
| `not-worth` | too little changed, let it collect |
| `blocked` | content changed, but the local version is not higher than on CurseForge |
| `current` | same as on CurseForge |
| `error` | not installed, or CurseForge unreachable |

**Gap:** the public list only shows approved files. A file still in moderation ("Processing") is
invisible to the script. If the maintainer uploaded something today that is not approved yet, a
pack can wrongly show `worth`. `hoursSince` under 24 is a hint; say so briefly in the report.

## 2. Report

In the maintainer's language if they wrote in it, else English. First a table of **only the
`worth` packs**:

| Pack | CurseForge → local | Change | Last file |
| --- | --- | --- | --- |
| Quests - Alliance | 1.0.1 → 1.1.0 | +198 new, 2 re-voiced, 72 removed | 15 days ago |

Below it, the `command` of each of these packs in its own code block (`powershell` on Windows,
`bash` elsewhere), so each can be copied on its own. On Windows the command calls Git Bash, not WSL
`bash`, which fails.

If no pack is worth it, say so in one sentence.

Then one to three sentences on the rest: which are collecting and which are `blocked`. A `blocked`
pack needs its version raised in the Manager before a release.

If a pack is new or gone, the language's meta package (`meta` in the output, e.g. "Spoken: German")
needs a new file with adjusted dependencies too. Say so then. Otherwise the meta package needs no
release.

## Big packs: upload on the website (`zip.mjs`)

The upload API (Manager and `spoken-release.sh`) refuses big files with HTTP 413; the CurseForge
website takes them (a 550 MB zip went through there on 2026-11-15). Packs listed in `webUpload` get a
`zip.mjs` command instead of the release command. It writes the pack at full quality to
`<workDir>/manual/<folder>-<version>.zip` (stored, not compressed, like `spoken-release.sh`) and
prints the display name and changelog. The maintainer uploads it with "Add File" on the project:
display name `<folder> <version>`, Release, game versions as on the last file, Spoken as Required
Dependency.

If another pack fails with 413 in the Manager, it belongs in `webUpload`. If a pack outside
`webUpload` grows past about 500 MB (`localMB`), mention it: the API will likely refuse it.
