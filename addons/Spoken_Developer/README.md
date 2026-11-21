# Spoken Developer

Tools for working on Spoken, which a player never needs: a **debug log** to send with a report,
the **Developer** page in Spoken's settings where Spoken's modules put their own tools (Spoken
Quests' Mock Missing Voice Over, for one), and the **boss camera editor**.

For developers only. It is not in Spoken's zip and is not published: there is no store page and
no release. Link it into the game from a checkout, or build a zip with
`scripts/developer/package.sh` to hand to someone asked for a log.

- The log is on once the module is installed: installing it is asking for one. Turn it off (or on
  again) with Spoken > Developer > Keep a Debug Log, the switch in Spoken's welcome
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
- `/spokenbosscam` (`/spbc`) sets where a boss's 3D model sits in its frame, in the Compendium and on the
  map's story panel. With it on, drag a boss to move it, right-drag to turn it and use the mouse wheel to
  zoom, from a quarter to 8 times the framing (the boss's model is a scene that takes the mouse only while editing); a guide frame shows the
  room the boss is framed to. `reset` drops the change made to the boss in
  view, `count` says how many models have one, `off` stops. Bosses on the same model file move together,
  and each place keeps its own change. A change moves the camera the game frames for the boss from its loaded
  model, so a boss whose model is still loading is left alone by the editor until it is framed. The changes are kept in `SpokenDeveloperDB.cameraEdits`
  (`[place][model group] = { right, up, zoom, turn }`) in the file above, which the camera pipeline's
  `import_edits.py` turns into `Data/CameraNudges.lua`. Chat and the on-screen hint are English.

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
| `Camera.lua` | the boss camera editor: the saved changes, the drag, wheel and guide, and what Spoken's TextView is handed |
| `UI/Box.lua` | the box a log or a copy is shown in, selected |
| `UI/Menu.lua` | the Report and Contribute buttons' right-click menu |
| `UI/Options.lua` | the Developer page |
| `Commands.lua` | `/spoken log ...`, `/spokenbosscam`, and the provider Spoken calls |
| `Events.lua` | registering with Spoken as it loads, the login |

Package with `scripts/developer/package.sh`. Tests: `tests/lua/developer_log_test.lua` (this
module) and `tests/lua/developer_hooks_test.lua` (Spoken's side); the camera editor in
`tests/lua/developer_camera_test.lua`.
