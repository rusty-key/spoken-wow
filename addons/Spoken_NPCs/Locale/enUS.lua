local _, NPCs = ...

-- Interface strings for Spoken NPCs, and the key set every other language is measured against.
--
-- FORMAT ARGUMENTS ARE POSITIONAL (%1$s, %2$d), even where there is only one. A locale file per
-- language overlays this table (Locale/<code>.lua), so anything missing falls back to English.

NPCs.L = NPCs.L or {}
local L = NPCs.L

L.COMPENDIUM_BOSSES = "Bosses"
L.BOSSES_SEARCH = "Search bosses"
L.BOSSES_NONE = "Nothing matches."
L.BOSSES_FOUND_ONLY = "Found Only"
L.BOSSES_FOUND_FMT = "%1$d of %2$d found"
L.BOSS_IN_FMT = "In %1$s"
L.BOSS_NOT_FOUND = "You have not met this boss yet. Fight it in its dungeon or raid to read its story here."
L.GROUP_LANDS = "Other Lands"
L.OPT_PAGE_TITLE = "Bosses"
L.OPT_SHOW_ABILITIES = "Show Boss Abilities"
L.OPT_RESET_PAGE_CONFIRM = "Reset every Bosses setting to its default?"
