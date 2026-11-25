# Changelog — Spoken Manager

Spoken Launcher until 0.1.2, when it became Spoken Manager.

## 0.2.5 — 2026-11-25

- **Enter a missing CurseForge project id right on the Release page,** beside the pack that
  needs it. *([rusty-key](https://github.com/rusty-key))*

## 0.2.4 — 2026-11-25

- **The Manager speaks German, Spanish, French, Korean, Portuguese, Russian and Traditional
  Chinese.** Choose it under Interface Language in Settings. *([anon1231823](https://github.com/anon1231823))*

## 0.2.3 — 2026-11-24

- **Maintainers of a team's own language can release from the Release page,** which now
  shows the language's name on its tab. *([rusty-key](https://github.com/rusty-key))*

## 0.2.2 — 2026-11-22

- **The Manager checks for updates every 30 minutes while it runs,** under Check for Updates
  Automatically in Settings. *([anon1231823](https://github.com/anon1231823))*
- **Send Now in Settings > Sharing says how many lines it sent,** or that there was nothing new.
  *([rusty-key](https://github.com/rusty-key))*
- **Sharing empties SpokenContributions.lua once it has sent the lines,** at your next login or
  /reload. Needs Spoken 3.12.0. *([rusty-key](https://github.com/rusty-key))*

## 0.2.1 — 2026-11-21

- **Use a proxy, in Settings > General > Network.** Left empty, the Manager follows the system
  proxy. *([Loukky](https://github.com/Loukky))*
- **Italian, Vietnamese and Polish voice packs come from their own teams**, listed like any
  team's language. *([rusty-key](https://github.com/rusty-key))*
- **The refresh icon turns the way its arrows point.** *([rusty-key](https://github.com/rusty-key))*

## 0.2.0 — 2026-11-19

- **Voice Packs lists every language and says who made each pack**, Spoken's own team or a
  language team, and filters a language's packs by author. A team's packs and a new language's
  install and update like the official ones.
  *([rusty-key](https://github.com/rusty-key))*
- **Install All takes the official packs, or asks whose** when a language has packs from more than
  one team. It also finishes a quests set that was only partly installed.
  *([rusty-key](https://github.com/rusty-key))*
- **For pack makers: a Zip button on each CurseForge row of the Release page.** CurseForge's API
  refuses files over 500 MB, while its site takes up to 1 GB, so the button zips the pack as an
  upload would send it and opens the upload page.
  *([rusty-key](https://github.com/rusty-key))*
- **The pack list no longer goes back to an older copy** when a slow answer arrives after a newer
  one, or while the Manager starts.
  *([rusty-key](https://github.com/rusty-key))*

## 0.1.14 — 2026-11-13

- **The Manager speaks Chinese.** Settings has a General section with a window language, English
  or Simplified Chinese. *([Loukky](https://github.com/Loukky))*
- **Community packs come from spoken.quest.** When it cannot be reached, the Manager shows the last
  packs it saw as offline instead of an empty list. *([rusty-key](https://github.com/rusty-key))*

## 0.1.13 — 2026-11-12

- **Spoken and its voice packs can update by themselves.** Turn on automatic updates in Settings
  and the Manager installs new versions after each check for them. It leaves alone a version you
  picked over the newest, and an update you cancelled, until you check again.
  *([anon1231823](https://github.com/anon1231823), [rusty-key](https://github.com/rusty-key))*
- **The Home card's Update button updates your voice packs too**, not only Spoken.
  *([anon1231823](https://github.com/anon1231823), [rusty-key](https://github.com/rusty-key))*
- **Start with your computer, and minimize to the system tray.** Both are in a Startup section of
  Settings. Opening the Manager again shows a window hidden in the tray, and on Linux the
  autostart entry points at the AppImage itself.
  *([anon1231823](https://github.com/anon1231823), [rusty-key](https://github.com/rusty-key))*
- **Community packs may be in any language**, not only the game's.
  *([rusty-key](https://github.com/rusty-key))*

## 0.1.12 — 2026-11-08

- **Spoken downloads from packs.spoken.quest**, with GitHub as the fallback. GitHub often answered
  with an error until you pressed Retry a few times. *([rusty-key](https://github.com/rusty-key))*

## 0.1.11 — 2026-11-05

- **Polish voice packs.** *([zaxcer](https://github.com/zaxcer))*
- **The Manager uses spoken.quest**, the site's and the voice packs' new address.
  *([rusty-key](https://github.com/rusty-key))*

## 0.1.10 — 2026-11-03

- **Refresh also checks for a new Manager**, and an update that is ready gets a Restart button.
  *([rusty-key](https://github.com/rusty-key))*
- **macOS asks for the Keychain only when you sign in** to release packs, not at every launch.
  *([rusty-key](https://github.com/rusty-key))*

## 0.1.9 — 2026-11-03

- No changes for players; this release fixes a test that failed on Windows.
  *([rusty-key](https://github.com/rusty-key))*

## 0.1.8 — 2026-11-03

- **For pack makers: a Release page beside Community.** Sign in, set up your CurseForge and GitHub
  projects for each language you look after, and upload your language's packs from the Manager,
  each with its own Upload button and the bytes sent so far.
  *([rusty-key](https://github.com/rusty-key))*

## 0.1.7 — 2026-11-02

- **Voice Packs shows every language's Alliance, Horde, Shared and Gossip quest packs.** It showed
  only the packs with a GitHub release, so the split packs were missing.
  *([rusty-key](https://github.com/rusty-key))*

## 0.1.6 — 2026-11-02

- **Every language's quest audio comes as Alliance, Horde, Shared and Gossip packs**, as English
  does, with an All bundle. Updating removes the old single pack's folder.
  *([rusty-key](https://github.com/rusty-key))*

## 0.1.5 — 2026-11-01

- **A large download no longer crashes the Manager** when the server closes the connection
  partway, as the 1.6 GB German quest pack did at 98%. A download that stalls for a minute now
  fails and can be retried instead of hanging.
  *([svengabr](https://github.com/svengabr), [rusty-key](https://github.com/rusty-key))*

## 0.1.4 — 2026-10-31

- **Spoken Bosses.** The Manager installs Spoken's new Bosses module and removes the old
  Spoken_NPCs folder it replaces. *([rusty-key](https://github.com/rusty-key))*
- **Installing or repairing the Places and Readables packs works again.** It failed on every
  try since they were renamed. *([rusty-key](https://github.com/rusty-key))*

## 0.1.3 — 2026-10-30

- **WoW: Forever is found in its `_forever_` folder** now that its beta has ended. A game folder
  added by hand as `_classic_beta_` moves to `_forever_`, and picking `_classic_beta_` says the
  beta has ended.
  *([svengabr](https://github.com/svengabr), [rusty-key](https://github.com/rusty-key))*
- **Linux has .deb and .rpm packages** beside the AppImage and the .tar.gz.
  *([anon1231823](https://github.com/anon1231823))*
- **Spoken's gold in place of blue**, and on macOS the window buttons sit above the tabs.
  *([Nucabe](https://github.com/Nucabe), [rusty-key](https://github.com/rusty-key))*
- **The 1.12, 2.4.3 and 3.3.5 clients are no longer supported.**
  *([rusty-key](https://github.com/rusty-key))*

## 0.1.2 — 2026-10-19

- **Spoken Launcher is now Spoken Manager.** *([rusty-key](https://github.com/rusty-key))*
