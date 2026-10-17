-- deDE. German interface strings for Spoken Places.
--
-- Every key in Locale/enUS.lua belongs here, with the same positional format
-- arguments (%1$s) in whatever order this language needs them. Anything missing
-- falls back to English at runtime, and the shortfall is what keeps this language
-- out of the switcher -- see tools/locale/build-languages.mjs.

local _, SpokenZones = ...

if GetLocale() ~= "deDE" then
	return
end

local L = {}

L.OPT_SECTION_MAP = "Geschichten"
L.OPT_MAP_PANEL = "Geschichte neben der Karte"
L.OPT_PICTURES = "Bilder zeigen"
L.OPT_MAP_HIGHLIGHT = "Gebietshervorhebung"
L.OPT_PANEL_WIDTH = "Breite der Geschichte"
L.OPT_PLAY_BUTTON = "Geschichten vorlesen"
L.OPT_AUTOPLAY = "Automatisch vorlesen"
L.OPT_AUTOPLAY_SUB = "Kleinere Gebiete einbeziehen"
L.OPT_AUTOPLAY_EXPLORED = "Früher gefundene Orte einbeziehen"
L.OPT_LANG_RELOAD = "Tippe /reload, um zu ihr zu wechseln."
L.OPT_LANGUAGE = "Textsprache"
L.OPT_LANG_AUTO_FMT = "Automatisch (%1$s)"
L.OPT_LANG_SET_FMT = "Nach dem Neuladen des Interfaces sind die Geschichten auf %1$s."
L.OPT_LANG_PROFILE_FMT = "Dieses Profil liest die Geschichten auf %1$s vor. Tippe /reload, um zu wechseln."
L.OPT_REPORT_PROBLEM = "Problem melden"
L.MENU_LORE_WINDOW = "„Kompendium von Azeroth“ öffnen"
L.MENU_ZONE_SETTINGS = "Einstellungen für Orte"

L.OPT_REPORT_LINE_TIP = "Erhalte einen Link, um eine falsche Geschichte, eine falsche Lesung oder einen falsch ausgesprochenen Namen zu melden."
L.OPT_REPORT_LINE_ADDRESS = "Kopiere diese Adresse und öffne sie in deinem Browser, um ein Problem mit diesem Eintrag zu melden."

L.AUDIO_READ_TIP = "Diese Geschichte vorlesen lassen."
L.REPORT_BUTTON = "Melden"
L.CONTRIBUTE_BUTTON = "Mitwirken"
L.CONTRIBUTE_BUTTON_TIP_TITLE = "Spoken Places hat keine Geschichte für diesen Ort"
L.CONTRIBUTE_BUTTON_TIP = "Wirke mit, indem du ihn beschreibst: was es ist, wer dort lebt, was dort geschah."
L.IN_ZONE_FMT = "Lage: %1$s"
L.DISCOVERED_FMT = "%1$d von %2$d entdeckt"

L.QUEUE_HELD_COMBAT = "Wartet auf Kampfende."
L.QUEUE_HELD_CINEMATIC = "Wartet auf das Ende der Zwischensequenz."
L.QUEUE_HELD_OFF = "Vertonung ist ausgeschaltet."
L.NO_LORE_FOR = "Noch keine Geschichte für %1$s erfasst."
L.LORE_NOT_WRITTEN = "%1$s ist auf der Karte, aber noch hat niemand die Geschichte dazu geschrieben."
L.NOT_DISCOVERED = "Diesen Ort hast du noch nicht entdeckt. Geh hin, um seine Geschichte zu lesen."
L.MAP_LORE_FOR_FMT = "Geschichte von %1$s"
L.CMD_HEADING = "Befehle (/spokenplaces oder /spp):"
L.CMD_STATUS = "  /spp            -- Status für aktuelle Zone und aktuelles Gebiet"
L.CMD_DIAGNOSTICS = "  /spp diagnostics -- Diagnose anzeigen"
L.CMD_OPTIONS = "  /spp settings   -- die Seite „Orte“ der Einstellungen"
L.CMD_WINDOW = "  /spp window     -- öffnet „Kompendium von Azeroth“"
L.CMD_PANEL = "  /spp panel      -- „Geschichte neben der Karte“ an oder aus"
L.CMD_PLAY = "  /spp play       -- liest die Geschichte des Ortes vor, an dem du bist"
L.CMD_STOP = "  /spp stop       -- hört auf vorzulesen"
L.CMD_VOICE = "  /spp voice      -- „Geschichten vorlesen“ an oder aus"
L.CMD_AUTOPLAY = "  /spp autoplay   -- „Automatisch vorlesen“ an oder aus"
L.CMD_AUDIO = "  /spp audio      -- die installierten Sprachpakete"
L.CMD_LANG = "  /spp lang       -- Textsprache: Liste, oder wechseln mit /spp lang <code> oder auto"
L.CMD_FORGET = "  /spp forget     -- Gehörte Orte vergessen"


-- Added in this release (deDE).
L.REASON_VOICE = "Schalte „Geschichten vorlesen“ ein, um dies zu nutzen."
L.OPT_FORGET_PLACES = "Gehörte Orte vergessen"
L.OPT_FORGET_PLACES_DONE = "Die Liste gehörter Orte dieses Charakters wurde gelöscht."
L.OPT_DOWNLOAD_ADDRESS = "Kopiere diese Adresse in deinen Webbrowser, um das Sprachpaket herunterzuladen."
L.OPEN_IN_LORE_TIP = "Die Geschichte dieses Orts im „Kompendium von Azeroth“, neben denen aller anderen Zonen und Gebiete."
L.OTHER_LANDS = "Andere Länder"
L.BATTLEGROUNDS = "Schlachtfelder"
L.DUNGEONS = "Dungeons und Schlachtzüge"
L.ZONES_PICK = "Wähle links eine Zone, um ihre Geschichte zu lesen. Umschalt-Klick auf ein Gebiet spielt dessen Geschichte nach dem ab, was gerade läuft."
L.DUNGEONS_PICK = "Wähle links einen Dungeon oder Schlachtzug, um seine Geschichte zu lesen. Umschalt-Klick darauf spielt die Geschichte nach dem ab, was gerade läuft."
L.COMPENDIUM_PLACES = "Orte"
L.LORE_PANEL_TITLE = "Ortsgeschichte"
L.MAP_PANEL_EXPAND = "Ortsgeschichte anzeigen"
L.PANEL_SHOWN = "Geschichte neben der Karte: an"
L.PANEL_HIDDEN = "Geschichte neben der Karte: aus"
L.LORE_SEARCH = "Orte suchen"
L.LORE_DISCOVERED_ONLY = "Nur entdeckte"
L.LORE_VOICED_ONLY = "Nur vertonte"
L.LORE_SEARCH_NONE = "Keine Treffer."
L.REASON_DISCOVERY = "Schalte „Automatisch vorlesen“ ein, um dies zu nutzen."
L.REASON_MAP_PANEL = "Schalte „Geschichte neben der Karte“ ein, um dies zu nutzen."
L.OPT_RESET_PAGE_CONFIRM = "Jede Einstellung für Orte auf den Standard zurücksetzen?"
L.OPT_RELOAD_NOW = "Jetzt neu laden"
L.OPT_LATER = "Später"
L.OPT_PAGE_TITLE = "Orte"
L.OPT_DEV_DEBUG = "Debug: Orte"
L.OPT_DEV_PREVIEW = "Unfertige Übersetzungen"

L.OPEN_IN_COMPENDIUM = "Im „Kompendium von Azeroth“ öffnen"

SpokenZones:RegisterStrings("deDE", L)
