# Artwork sources

The Minimal Classic textures are derived from WoW UI assets and the existing
Spoken artwork. They are not covered by the project's MIT code license.
See the repository's [third-party notice](../../THIRD_PARTY.md).

- Native textures were referenced through the `classic` branch of
  [Gethe/wow-ui-textures](https://github.com/Gethe/wow-ui-textures/tree/classic)
  and the textures shipped with Spoken and Spoken Quests.
- `MinimalBackground.tga` uses the darkened `FrameGeneral/UI-Background-Rock`
  material.
- `MinimalParchment.tga` is a band of the game's spellbook page, cut to the window's shape.
- `MinimalPortraitRing.tga` uses a cleaned target-frame ring, with its old
  health/mana-bar remnants removed, desaturated and darkened.
- `MinimalBullet*.tga` uses the existing quest/gossip glyphs, alpha-trimmed
  and centered; the portrait background and mask complete the circular framing.
- Book and zone badges use the client's own `GossipFrame\TrainerGossipIcon`
  and `WorldMap\UI-World-Icon` (`addons/Spoken/UI/Face.lua`). A place story's portrait is its zone's icon, one of
  the 57 bundled in `addons/Spoken/Textures/Zones/` (`Spoken:ZoneIcon`), which the
  Compendium's zone rows show too; [THIRD_PARTY.md](../../THIRD_PARTY.md) says
  where they come from.
- Runtime textures are power-of-two RGBA TGA files. Fonts and remaining
  native interface textures are referenced from the client at runtime.

The PNG images in this directory are browser design previews, not in-game
screenshots. Preview font files are not bundled in this repository.
