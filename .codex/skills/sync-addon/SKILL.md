---
name: sync-addon
description: Sync this Spoken worktree's addons to a World of Warcraft client on another machine using the repository's developer sync script. Use when the client is remote; for a client on this machine, use link-addon instead.
argument-hint: "[forever|era|tbc]"
---

# Sync addon

This is the Codex entry point for `/sync-addon`. Read
`.claude/skills/sync-addon/SKILL.md` before acting; it is the canonical
workflow and safety boundary.

If the WoW client is local, route to `.codex/skills/link-addon/SKILL.md` and
link the current worktree directly. If the client is remote, use the current
worktree's `scripts/developer/sync-addons.sh` on that machine. The supported
clients are `forever`, `era`, and `tbc`.

The standard remote command is:

```bash
set -o pipefail
ssh ${SPOKEN_DEV_HOST:-dev} cat <worktree path>/scripts/developer/sync-addons.sh | bash -s -- --watch <worktree name> <client>
```

Use `SPOKEN_DEV_HOST` when the configured server is not `dev`. The script
copies the same TOC-bearing, non-audio addon folders selected by `link-addon`,
keeps them current through Mutagen with `--watch`, and preserves the same
timestamped backups. A new watch replaces the previous worktree watch;
`--stop` ends it. Without Mutagen, omit `--watch` and rerun before reloads.

Do not pretend a remote sync completed if SSH or Mutagen failed. Report the
command and the observed result, then remind the user to `/reload` or restart
the client when an addon is new.
