---
name: spoken-lang-release
description: Check whether a Spoken language's CurseForge audio packs have enough local changes to justify a release, and print maintainer-run commands without uploading anything. Use for release readiness checks, not for generating voices or publishing packs automatically.
argument-hint: "<lang>"
---

# Spoken language release check

This is the Codex entry point for `/spoken-lang-release`. Read
`.claude/skills/spoken-lang-release/SKILL.md` before acting; it is the
canonical release policy and reporting format.

The language is a publisher language such as `deDE`, `frFR`, or `esMX`. Run
the read-only checker:

```bash
node .claude/skills/spoken-lang-release/check.mjs --lang <lang> --json
```

It compares the locally installed pack contents with the newest approved
CurseForge file by path, size, and CRC, writes changelogs under the configured
work directory, and identifies only packs meeting the configured clip/share
threshold. Report the `worth` packs first, then collecting or blocked packs,
then each `error` pack with its reason. When any pack has an `error` verdict,
do not report that no pack is worth releasing; state that the check is incomplete.
Print each suggested command in its own code block.

Never read, print, copy, or expose `spoken-release.env`; it contains the
CurseForge token. Never run the commands printed by the checker and never
upload a pack. For a pack configured for website upload, the suggested
`zip.mjs` command only creates a local full-quality zip; the maintainer must
upload it manually. Mention the approved-files-only gap when a recent upload
may still be processing, and mention when a meta package needs a new file.

The helper currently reads the shared maintainer config from
`~/.claude/spoken/<lang>/config.json`. Use it as-is when present, without
printing secrets or silently moving it into another config location. If it is
missing or incomplete, report the setup requirement and do not guess release
paths or credentials.
