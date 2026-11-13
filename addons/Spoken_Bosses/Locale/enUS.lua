local _, Bosses = ...

-- Interface strings for Spoken Bosses, and the key set every other language is measured against.
--
-- FORMAT ARGUMENTS ARE POSITIONAL (%1$s, %2$d), even where there is only one. A locale file per
-- language overlays this table (Locale/<code>.lua), so anything missing falls back to English.

Bosses.L = Bosses.L or {}
local L = Bosses.L

L.COMPENDIUM_BOSSES = "Bosses"
L.BOSSES_SEARCH = "Search bosses"
L.BOSSES_NONE = "Nothing matches."
L.BOSSES_FOUND_ONLY = "Found Only"
L.BOSSES_FOUND_FMT = "%1$d of %2$d found"
L.BOSS_IN_FMT = "In %1$s"
L.BOSS_NOT_FOUND = "You have not met this boss yet. Fight it in its dungeon or raid to read its story here."
L.GROUP_LANDS = "Other Lands"
L.OPT_PAGE_TITLE = "Bosses"
L.OPT_RESET_PAGE_CONFIRM = "Reset every Bosses setting to its default?"
L.OPT_FORGET_STORIES = "Forget Stories Shown"
L.OPT_FORGET_STORIES_DONE_FMT = "Stories forgotten: %1$d. They will be shown again."
L.OPT_DOWNLOAD_ADDRESS = "Copy this address into your web browser to download the voice pack."
L.PART_ABOUT = "A boss's story, in the narrator, when you kill it."
