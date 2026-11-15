---
name: link-addon
description: Use when asked to link, install, sync or point the addons at a WoW client, or when invoked as /link-addon [client]. Symlinks every addon folder of the current worktree into the client's Interface/AddOns, so the client runs this checkout's code; when the client is on another machine, gives the command that copies them there and keeps them in step. Client is forever (default), era or tbc.
argument-hint: "[forever|era|tbc]"
---

# Link addon

Point a WoW client at the addons in the current worktree, so `/reload` in game runs this
checkout's code. Several worktrees exist side by side, and the client loads whichever one was
linked last, so relink whenever you switch worktree.

## 1. Pick the client

The argument names the client. Without one, use `forever`.

| Argument | Client                       | Folder under `/Applications/World of Warcraft` |
|----------|------------------------------|------------------------------------------------|
| `forever`| WoW: Forever                 | `_forever_`                                    |
| `era`    | Classic Era                  | `_classic_era_`                                |
| `tbc`    | TBC Anniversary (2.5.x)      | `_anniversary_`                                |

Any other argument: stop and list these three. If `/Applications/World of Warcraft` is not on
this machine, go to step 2. If it is but the client's `Interface/AddOns` folder is not, stop and
say that client is not installed.

## 2. Client on another machine

If the client's folder is not on this machine, the worktree is on a server and the client is on
the player's own computer. Nothing here can reach that computer, so don't link. Give the user
the command to run there, filled in with this worktree's folder name and path and the client:

```sh
ssh dev cat <worktree path>/scripts/developer/sync-addons.sh | bash -s -- --watch <worktree name> <client>
```

Or, from a checkout on that computer, `scripts/developer/sync-addons.sh --watch <worktree name>
<client>`. It copies the same folders this skill links, with the same backups, and `--watch`
keeps them in step through Mutagen until `--stop` or the next `--watch`, so after it the user
only needs `/reload`. Without Mutagen, leave out `--watch` and run it again before each
`/reload`. The server's ssh host is `dev` unless `SPOKEN_DEV_HOST` names another. The script's
header has the rest.

An agent on the client's computer, asked to run a worktree that lives on the server, runs that
command itself instead of giving it.

## 3. Link

The source is `addons/` at the root of the current worktree (`git rev-parse --show-toplevel`),
never the main checkout.

Link every folder in `addons/` that has a `.toc`, except the audio packs (any folder whose name
contains `Audio`). The audio packs carry their mp3s outside git, so the worktree copy is usually
empty and linking it would silence the client.

For each folder, the destination is `<client>/Interface/AddOns/<folder name>`:

- Destination is a symlink: replace it (`ln -sfn`).
- Destination does not exist: create the symlink.
- Destination is a real directory (usually an installed release): move it into
  `<client>/Interface/AddOns.bak/<YYYYMMDD-HHMMSS>/`, one timestamped folder per run, then
  create the symlink. Left in place, the client would run the release beside this checkout's
  other addons. The backup sits outside `AddOns` so the client never loads it. Never delete a
  backup.

SavedVariables live under `WTF/`, so relinking never touches settings.

## 4. Report

Show the client and, for each addon, where it now points. Then list:

- real directories that were moved, and the backup folder they went to;
- Spoken symlinks in that `AddOns` folder that point into a different worktree and were not
  replaced (for example audio packs linked to another checkout's `dist/`), so a stale link is
  visible.

Remind the user to `/reload`, or to restart the client if an addon was added that it had not
seen before: the client only scans the `AddOns` folder at startup.
