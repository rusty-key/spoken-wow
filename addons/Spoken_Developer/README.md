# Spoken Developer

Tools for trying Spoken out, which a player never needs: a **debug log** to send with a report,
and the **Developer** page in Spoken's settings where Spoken's modules put their own tools (Spoken
Quests' Mock Missing Voice Over, for one). A download of its own, beside Spoken.

- The log is on once the module is installed: installing it is asking for one. Turn it off (or on
  again) with Spoken > Developer > Enable Debug Log Recording, the switch in Spoken's welcome
  window, or `/spoken log off`. Off, nothing is kept.
- Right-click any **Report a Problem** or **Contribute** button: the log's size, **Copy the Debug
  Log** (with the diagnostics, to send with a report), or **Write the Debug Log for an AI Agent**
  (the state of the moment, then a reload so the game writes the file an agent on this computer
  reads: `scripts/developer/read-log.py`). Then ask it, for example: "The voice-over did not
  play for the quest I just opened. Read the Spoken debug log and tell me why." The Developer page
  says so under its buttons. An agent that cannot read this computer's files (a chat in the
  browser) takes Copy the Debug Log instead, pasted into its window with the question.
- `/spoken log [count] | copy | write | on | off | clear | diag`.
- Saved in `WTF\Account\<account>\SavedVariables\Spoken_Developer.lua`, the newest 2000 lines.

How it works, what a line says and the API for feature addons:
[`docs/spoken/DEBUG-LOG.md`](../../docs/spoken/DEBUG-LOG.md).

## Files

| File | |
|---|---|
| `Core.lua` | the namespace, the saved variables, the Spoken probe, where to draw over DialogueUI |
| `Log.lua` | the log: lines, sessions, Spoken's queue through its callbacks, logs handed in, the merge |
| `Copy.lua` | the diagnostics written into the log, and the copy |
| `Write.lua` | Write for an AI Agent: the snapshot, then the reload that writes the file |
| `Screen.lua` | the reading window and the mailbox in the log and the snapshots, and which Spoken modules are installed |
| `UI/Box.lua` | the box a log or a copy is shown in, selected |
| `UI/Menu.lua` | the Report and Contribute buttons' right-click menu |
| `UI/Options.lua` | the Developer page |
| `Commands.lua` | `/spoken log ...`, and the provider Spoken calls |
| `Events.lua` | registering with Spoken as it loads, the login |
| `UI/Layout.lua` | the settings layout every Spoken addon carries, byte-identical |

Package with `scripts/developer/package.sh`. Tests: `tests/lua/developer_log_test.lua` (this
module) and `tests/lua/developer_hooks_test.lua` (Spoken's side).
