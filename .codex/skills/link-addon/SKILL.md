---
name: link-addon
description: Link this Spoken worktree's World of Warcraft addons into a local Forever, Classic Era, or TBC client. Use when asked to install, point, or symlink addons; exclude Spoken audio packs and preserve real installed directories in a timestamped backup.
argument-hint: "[forever|era|tbc]"
---

# Link addon

This is the Codex entry point for the repository's `/link-addon` workflow.
Read `.claude/skills/link-addon/SKILL.md` before acting; it is the canonical
policy for which folders to link and how to handle backups.

The source is `addons/` at the root of the current worktree, resolved with
`git rev-parse --show-toplevel`. Do not link from a different checkout or from
an installed release. The supported clients are `forever`, `era`, and `tbc`.
Discover the installed client root on the current machine instead of assuming
the platform-specific example path in the Claude instructions.

Link every immediate `addons/` child containing a `.toc`, except folders whose
name contains `Audio`. Audio packs carry their media outside git; linking an
empty worktree folder would silence the client.

For each selected addon, make `<client>/Interface/AddOns/<name>` point to the
worktree folder. Replace an existing symlink. If a real directory is present,
move it to `<client>/Interface/AddOns.bak/<YYYYMMDD-HHMMSS>/` before linking;
never delete that backup. Stop on an unexpected non-directory file. Do not
touch `WTF/` or unrelated addon folders.

Report every resulting target, every moved directory and backup path, and any
pre-existing Spoken audio symlink that was intentionally left alone. Remind
the user to `/reload`, or restart the client when a newly linked addon needs a
fresh scan.
