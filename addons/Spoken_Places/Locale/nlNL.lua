-- nlNL. Dutch interface strings for Spoken Places.
--
-- Every key in Locale/enUS.lua belongs here, with the same positional format
-- arguments (%1$s) in whatever order this language needs them. Anything missing
-- falls back to English at runtime.
--
-- No game client runs in Dutch, so this file loads where the player chose it in
-- Spoken's Interface Language, and Language.lua reads it as the interface locale.
-- It is not a content language: the lore stays in the one chosen under Text Language.

local _, SpokenPlaces = ...

if not (Spoken and Spoken.InterfaceLanguage and Spoken:InterfaceLanguage() == "nlNL") then
	return
end

local L = {}

L.QUEUE_HELD_COMBAT = "Wacht tot het gevecht voorbij is."
L.QUEUE_HELD_CINEMATIC = "Wacht tot de filmscène voorbij is."
L.QUEUE_HELD_OFF = "Vertellen staat uit."
L.NOT_DISCOVERED = "Je hebt deze plaats nog niet ontdekt. Ga erheen om het verhaal ervan te lezen."
L.CMD_HEADING = "opdrachten (/spokenplaces of /spp):"
L.CMD_STATUS = "  /spp            -- status van de huidige zone en het huidige gebied"
L.CMD_DIAGNOSTICS = "  /spp diagnostics -- Diagnose tonen"
L.CMD_OPTIONS = "  /spp settings   -- de pagina Plaatsen van de instellingen"
L.CMD_WINDOW = "  /spp window     -- Compendium van Azeroth openen"
L.CMD_PANEL = "  /spp panel      -- ‘Verhaal naast de kaart’ aan of uit"
L.CMD_PLAY = "  /spp play       -- het verhaal voorlezen van de plek waar je bent"
L.CMD_STOP = "  /spp stop       -- stoppen met voorlezen"
L.CMD_VOICE = "  /spp voice      -- ‘Verhalen voorlezen’ aan of uit"
L.CMD_AUTOPLAY = "  /spp autoplay   -- ‘Automatisch voorlezen’ aan of uit"
L.CMD_AUDIO = "  /spp audio      -- de geïnstalleerde stempakketten"
L.CMD_LANG = "  /spp lang       -- Teksttaal: lijst, of wisselen met /spp lang <code> of auto"
L.CMD_FORGET = "  /spp forget     -- Gehoorde plaatsen vergeten"

L.OPT_SECTION_MAP = "Verhalen"
L.OPT_MAP_PANEL = "Verhaal naast de kaart"
L.OPT_PICTURES = "Afbeeldingen tonen"
L.OPT_MAP_HIGHLIGHT = "Gebied markeren"
L.OPT_PANEL_WIDTH = "Breedte van het verhaal"
L.OPT_PLAY_BUTTON = "Verhalen voorlezen"
L.REASON_VOICE = "Zet ‘Verhalen voorlezen’ aan om dit te gebruiken."
L.OPT_AUTOPLAY = "Automatisch voorlezen"
L.OPT_AUTOPLAY_SUB = "Ook kleinere gebieden"
L.OPT_AUTOPLAY_EXPLORED = "Ook eerder gevonden plaatsen"
L.OPT_AUTOPLAY_COMBAT = "Stoppen als een gevecht begint"
L.OPT_AUTOPLAY_EVERY_VISIT = "Bij elk bezoek voorlezen"
L.OPT_AUTOPLAY_GAP = "Opnieuw voorlezen na"
L.OPT_GAP_1D = "1 dag"
L.OPT_GAP_1W = "1 week"
L.OPT_GAP_1MO = "1 maand"
L.OPT_FORGET_PLACES = "Gehoorde plaatsen vergeten"
L.OPT_FORGET_PLACES_DONE = "De lijst met gehoorde plaatsen van dit personage is gewist."
L.OPT_DOWNLOAD_ADDRESS = "Kopieer dit adres naar je webbrowser om het stempakket te downloaden."
L.OPT_LANG_RELOAD = "Typ /reload om over te schakelen."
L.OPT_LANGUAGE = "Teksttaal"
L.OPT_LANG_AUTO_FMT = "Automatisch (%1$s)"
L.OPT_LANG_SET_FMT = "Na het herladen van de interface zijn de verhalen in %1$s."
L.OPT_LANG_PROFILE_FMT = "Dit profiel leest de verhalen in %1$s. Typ /reload om over te schakelen."
L.OPT_REPORT_PROBLEM = "Probleem melden"
L.OPT_REPORT_LINE_ADDRESS = "Kopieer dit adres en open het in je browser om een probleem met dit item te melden."

L.MENU_LORE_WINDOW = "Compendium van Azeroth openen"
L.MENU_ZONE_SETTINGS = "Instellingen van Plaatsen"

L.REPORT_BUTTON = "Melden"
L.IN_ZONE_FMT = "In %1$s"
L.DISCOVERED_FMT = "%1$d van %2$d ontdekt"
L.ZONE_COUNT_FMT = "%1$d zones"
L.ZONE_COUNT_ONE = "1 zone"
L.CONTINENT_COUNT_FMT = "%1$d continenten"
L.CONTINENT_COUNT_ONE = "1 continent"
L.OTHER_LANDS = "Andere landen"
L.BATTLEGROUNDS = "Slagvelden"
L.DUNGEONS = "Dungeons en raids"
L.COMPENDIUM_PLACES = "Plaatsen"
L.LORE_PANEL_TITLE = "Verhaal van de plaats"
L.BOSS_LORE_TITLE = "Verhaal van de baas"
L.MAP_PANEL_EXPAND = "Verhaal van de plaats tonen"
L.PANEL_SHOWN = "Verhaal naast de kaart: aan"
L.PANEL_HIDDEN = "Verhaal naast de kaart: uit"
L.LORE_SEARCH = "Plaatsen zoeken"
L.LORE_DISCOVERED_ONLY = "Alleen ontdekte"
L.LORE_VOICED_ONLY = "Alleen ingesproken"
L.LORE_SEARCH_NONE = "Geen resultaten."
L.MAP_LORE_FOR_FMT = "verhaal van %1$s"
L.REASON_DISCOVERY = "Zet ‘Automatisch voorlezen’ aan om dit te gebruiken."
L.REASON_EVERY_VISIT = "Zet ‘Bij elk bezoek voorlezen’ uit om dit te gebruiken."
L.REASON_MAP_PANEL = "Zet ‘Verhaal naast de kaart’ aan om dit te gebruiken."
L.OPT_RESET_PAGE_CONFIRM = "Elke instelling van Plaatsen terugzetten naar de standaardwaarde?"
L.OPT_RELOAD_NOW = "Nu herladen"
L.OPT_LATER = "Later"
L.OPT_PAGE_TITLE = "Plaatsen"
L.OPT_DEV_DEBUG = "Debugberichten van Plaatsen"
L.OPT_DEV_PREVIEW = "Onvoltooide vertalingen aanbieden"

L.OPEN_IN_COMPENDIUM = "Openen in het Compendium van Azeroth"

SpokenPlaces:RegisterStrings("nlNL", L)
