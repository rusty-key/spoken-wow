# Minimal Classic player

The compact layout SpokenPlayer offers as the **Small Window** narrator style on
the modern clients, shipped in the player since 2.2.0. Contributed by
[shorley-gm](https://github.com/shorley-gm), written against 2.0.4 and ported
onto 2.1.0 before it was merged.

The player shows a round native still portrait, gold speaker name, narration
title and narrow cast-style progress bar. There is no permanent button row.
The dark rock background and metal trim use WoW artwork.

Nothing is installed separately: it is part of the player's zip. Choose it as
the narrator style on Spoken's settings page, in the welcome window, or with
`/sp player minimal`; `/sp player classic` gives the original layout (Large
Window), `subtitle` the subtitles and `none` the voice alone. The 1.12, 2.4.3
and 3.3.5 clients have no Small Window.

In-game validation used the 2.0.4-based layout in the modern Classic beta
client; the port onto 2.1.0 is checked with the offline suites. Other modern
flavors have not been visually verified.

## Controls

| Interaction | Action |
|---|---|
| Click portrait | Pause, or restart the line from the beginning |
| Click narration title | Skip the line, as in the original player |
| Click plus/minus button | Expand/collapse the waiting queue; the number beside it counts waiting lines |
| Scroll expanded queue | Browse more than four waiting lines |
| Click waiting line | Remove it from the queue |
| Right-click portrait, speaker, title or panel | Playback menu and source actions, including Report/Stop Gossip |
| Drag speaker name or panel | Move the unlocked player |
| Hover collapsed player | Reveal the resize grip |
| `/sp options` | Narrator style, scale, lock and the window's other settings |
| `/sp player minimal` | Switch to this layout (`classic`, `subtitle` or `none` for the others) |
| `/sp reset` | Reset the active layout's position and width |
| `/sp diagnostics` | Inspect playback, UI state and captured callback errors |

The hidden-portrait and optional-action settings remain effective in this
layout.

An empty queue hides the player. Test a quest with available narration when
checking it. WoW cannot resume a sound partway through: play after pause
restarts the line, and the progress bar resets accordingly.

## Design previews

These are screenshots of the browser mockup used to review the design,
not captures of the WoW client. Actual portrait appearance comes from the game.

![Compact player design preview](design-preview.png)

![Expanded queue design preview](queue-design-preview.png)

## Implementation

- `addons/SpokenPlayer/UI/MinimalPlayer.lua`: layout, menu, queue drawer,
  progress and fades over the existing queue/actions services.
- `addons/SpokenPlayer/UI/StaticPortrait.lua`: native `SetPortraitTexture`
  snapshots captured while the speaker's unit token still exists.
- Small integration changes in `addon.xml`, `API.lua`, `Core.lua`,
  `Strings.lua`, `UI/Options.lua` and `UI/PlayerFrame.lua`.
- Nine power-of-two RGBA textures under `Textures/Minimal*.tga`.

Portraits are cached as native Texture regions, keyed by exact unit GUID,
with at most 32 entries. Queued/current portraits are protected from eviction.
Synthetic quest-log identities may use an encountered portrait of the same
creature type. A quest-log giver not met this session is drawn from its
creature id instead (`SetCreature` on a hidden `DressUpModel`, then
`SetPortraitTextureFromCreatureDisplayID`). An uncached creature is asked
for again every 0.05 s for up to 5 s while the client fetches it, and the
quest log asks for each giver as it draws their play button, so the fetch is
usually done before the click. Missing portraits use the source
image/book fallback rather than borrowing an unrelated target's face.

Source-owned action buttons retain their original handlers. The public player
frame API returns the selected layout. The queue and narration producer are
the player's own, unchanged.

## Verification

The existing offline integration harness is included in
[`tests/minimal-classic`](../../tests/minimal-classic/README.md). It exercises
the real queue and UI code, including pause/restart timing, held gates,
pagination/removal, source actions, visibility settings, original-layout
fallback, portrait identity/cache/fallback and artwork dimensions.

The original-layout regression tests remain in `tests/lua` and run with
`make test-player` (LuaJIT or Lua 5.1). Their loader includes the layout's
modules and explicitly selects the original layout.

**In-game status (2026-09-22):** the final native-static-portrait, inset-border
and opaque-badge revision was confirmed working in the Classic beta client
on the 2.0.4-based installation. Two player-supplied screenshots show Gryan
Stoutmantle's greeting and The People's Militia narration, including the
right-click menu. The player confirmed all requested checks: appearance,
portrait identity after dialogue/target changes, playback/queue/menu controls
and switching back to the original layout.

The same UI is what 2.2.0 ships, on top of 2.1.0's contribution features and
scrolling settings panel. The port is verified with the offline integration and
the regression suites; the screenshots document the earlier 2.0.4-based
runtime. Offline fixtures do not emulate WoW rendering.

## Credits

The layout was designed and written by
[shorley-gm](https://github.com/shorley-gm) and contributed in
[#46](https://github.com/rusty-key/spoken-wow/pull/46). Game-derived textures
remain Blizzard Entertainment artwork; see [`THIRD_PARTY.md`](../../THIRD_PARTY.md) and
[`ARTWORK.md`](ARTWORK.md) for sources.
