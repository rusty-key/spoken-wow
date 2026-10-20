local _, NPCs = ...

-- German interface strings for Spoken NPCs.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = NPCs.L

if GetLocale() ~= "deDE" then
	return
end
L.COMPENDIUM_BOSSES = "Bosse"
L.BOSSES_SEARCH = "Bosse suchen"
L.BOSSES_NONE = "Keine Treffer."
L.BOSSES_FOUND_ONLY = "Nur gefundene"
L.BOSSES_FOUND_FMT = "%1$d von %2$d gefunden"
L.BOSS_IN_FMT = "Lage: %1$s"
L.BOSS_NOT_FOUND = "Du bist diesem Boss noch nicht begegnet. Stelle dich ihm im Dungeon oder Schlachtzug, um seine Geschichte hier zu lesen."
L.GROUP_LANDS = "Andere Länder"
L.OPT_PAGE_TITLE = "Bosse"
L.OPT_SHOW_ABILITIES = "Boss-Fähigkeiten anzeigen"
L.OPT_RESET_PAGE_CONFIRM = "Jede Einstellung für Bosse auf den Standard zurücksetzen?"
