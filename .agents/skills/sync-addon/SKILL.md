---
name: sync-addon
description: Use when the worktree is on a server and the WoW client on another machine, and asked to sync, link or run the addons in that client, or when invoked as /sync-addon [client]. Gives the command that copies this worktree's addons into the client and keeps them in step. For a client on this machine, use /link-addon. Client is forever (default), era or tbc.
argument-hint: "[forever|era|tbc]"
---

# Sync addon

Run this worktree's addons in a WoW client on another machine, through
`scripts/developer/sync-addons.sh`. The script runs on the client's machine and pulls from the
server; nothing on the server can reach that machine.

## 1. Check the target

- The argument names the client: `forever` (default), `era` or `tbc`. Any other argument: stop
  and list these three.
- If `/Applications/World of Warcraft` is on this machine, the client is here: use
  `/link-addon` instead.

## 2. Give the command

Fill in this worktree's path and folder name (`git rev-parse --show-toplevel`) and the client:

```sh
ssh dev cat <worktree path>/scripts/developer/sync-addons.sh | bash -s -- --watch <worktree name> <client>
```

It streams the script from the server, so that machine needs no checkout. From a checkout there,
`scripts/developer/sync-addons.sh --watch <worktree name> <client>` does the same.

Tell the user, briefly:

- It copies the folders `/link-addon` would link, with the same backups, and `--watch` keeps
  them in step through Mutagen, so after it only `/reload` is needed. `--watch` stays open in
  the window and lists each file as it lands, and any problem, such as the worktree being
  deleted. Ctrl-C or closing the window ends it. A new `--watch` for another worktree replaces
  it; `--stop` ends one whose window was killed.
- Without Mutagen (`brew install mutagen-io/mutagen/mutagen`), drop `--watch` and run the
  command again before each `/reload`.
- The server's ssh host is `dev` unless `SPOKEN_DEV_HOST` names another.
- `/reload` in game, or restart the client if an addon is new to it.

An agent running on the client's machine, asked to run a worktree that lives on the server,
runs the command itself instead of giving it, then reports the script's output.
