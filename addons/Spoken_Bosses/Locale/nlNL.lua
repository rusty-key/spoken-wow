local _, Bosses = ...

-- Dutch interface strings for Spoken Bosses.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.
-- No game client runs in Dutch, so this file loads where the player chose it in
-- Spoken's Interface Language, after the client's own file.

local L = Bosses.L

if not (Spoken and Spoken.InterfaceLanguage and Spoken:InterfaceLanguage() == "nlNL") then
	return
end
L.COMPENDIUM_BOSSES = "Bazen"
L.BOSSES_SEARCH = "Bazen zoeken"
L.BOSSES_NONE = "Geen resultaten."
L.BOSSES_FOUND_ONLY = "Alleen gevonden"
L.BOSSES_FOUND_FMT = "%1$d van %2$d gevonden"
L.BOSS_IN_FMT = "In %1$s"
L.BOSS_NOT_FOUND = "Je bent deze baas nog niet tegengekomen. Bevecht hem in zijn dungeon of raid om zijn verhaal hier te lezen."
L.GROUP_LANDS = "Andere landen"
L.OPT_PAGE_TITLE = "Bazen"
L.OPT_RESET_PAGE_CONFIRM = "Elke instelling van Bazen terugzetten naar de standaardwaarde?"
L.OPT_FORGET_STORIES = "Getoonde verhalen vergeten"
L.OPT_FORGET_STORIES_DONE_FMT = "Verhalen vergeten: %1$d. Ze worden opnieuw getoond."
L.OPT_DOWNLOAD_ADDRESS = "Kopieer dit adres naar je webbrowser om het stempakket te downloaden."
L.PART_ABOUT = "Het verhaal van een baas, verteld door de verteller, als je hem verslaat."
