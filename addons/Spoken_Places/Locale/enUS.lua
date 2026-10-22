-- English, and the key set every other language is measured against.
--
-- tools/locale/check-strings.mjs reads this file to decide what a translation has
-- to cover, so a key added here immediately makes every language incomplete --
-- which is the point: a new string nobody has translated should stop a language
-- being offered as finished.
--
-- FORMAT ARGUMENTS ARE POSITIONAL (%1$s, %2$d), even where there is only one and
-- the position is obvious. Word order is the thing a translator most often has to
-- change and least often can, and retrofitting positions across hundreds of
-- strings later is a second sweep of every file.
--
-- Only the files listed below draw their text from here so far. The rest still
-- hold English literals; converting one is mechanical, and UI/SoundQueueUI.lua is
-- the worked example.
--
--   UI/SoundQueueUI.lua  every label and tooltip
--   UI/MapPanel.lua      the two sentences that were built by concatenation
--   UI/Options.lua       the settings panel rows
--   Audio.lua            the player menu entries and settings link
--   Core.lua             the /spp command list

local _, SpokenZones = ...

local L = {}

--------------------------------------------------------------------------------
-- Playback controls
--------------------------------------------------------------------------------



--------------------------------------------------------------------------------
-- Queue
--------------------------------------------------------------------------------


-- Why a discovery is queued but silent. Without these, narration waiting out a
-- pull looks exactly like narration that failed.
L.QUEUE_HELD_COMBAT = "Waiting for combat to end."
L.QUEUE_HELD_CINEMATIC = "Waiting for the cinematic to end."
L.QUEUE_HELD_OFF = "Narration is turned off."

--------------------------------------------------------------------------------
-- Map panel
--
-- Both of these were built with `..` around a zone name, which fixes English word
-- order into every language. They are the reason the rule above exists.
--------------------------------------------------------------------------------

L.NOT_DISCOVERED = "You have not discovered this place yet. Go there to read its story."

--------------------------------------------------------------------------------
-- Slash commands
--------------------------------------------------------------------------------

L.CMD_HEADING = "commands (/spokenplaces, or /spp):"
L.CMD_STATUS = "  /spp            -- status for the current zone and area"
L.CMD_DIAGNOSTICS = "  /spp diagnostics -- Show Diagnostics"
L.CMD_OPTIONS = "  /spp settings   -- the Places page of the settings"
L.CMD_WINDOW = "  /spp window     -- open Azeroth's Compendium"
L.CMD_PANEL = "  /spp panel      -- Show Story Beside Map, on or off"
L.CMD_PLAY = "  /spp play       -- read the story of where you are"
L.CMD_STOP = "  /spp stop       -- stop reading"
L.CMD_VOICE = "  /spp voice      -- Read Stories Aloud, on or off"
L.CMD_AUTOPLAY = "  /spp autoplay   -- Read Automatically, on or off"
L.CMD_AUDIO = "  /spp audio      -- the voice packs installed"
L.CMD_LANG = "  /spp lang       -- Text Language: list, or switch with /spp lang <code> or auto"
L.CMD_FORGET = "  /spp forget     -- Forget Places Heard"

--------------------------------------------------------------------------------
-- Options panel
--------------------------------------------------------------------------------

L.OPT_SECTION_MAP = "Stories"
L.OPT_MAP_PANEL = "Show Story Beside Map"
L.OPT_PICTURES = "Show Pictures"
L.OPT_MAP_HIGHLIGHT = "Area Highlight"
L.OPT_PANEL_WIDTH = "Story Panel Width"
L.OPT_PLAY_BUTTON = "Read Stories Aloud"
L.REASON_VOICE = "Turn on Read Stories Aloud to use this."
L.OPT_AUTOPLAY = "Read Automatically"
L.OPT_AUTOPLAY_SUB = "Include Smaller Areas"
L.OPT_AUTOPLAY_EXPLORED = "Include Places Found Before"
L.OPT_AUTOPLAY_EXPLORED_TIP = "Reads each place once per character, even one discovered before."
L.OPT_FORGET_PLACES = "Forget Places Heard"
L.OPT_FORGET_PLACES_DONE = "This character's list of places heard is cleared."
L.OPT_DOWNLOAD_ADDRESS = "Copy this address into your web browser to download the voice pack."
L.OPT_LANG_RELOAD = "Type /reload to switch to it."
L.OPT_LANGUAGE = "Text Language"
L.OPT_LANGUAGE_TIP = "The stories' text; the voice follows Voice Language."
L.OPT_LANG_AUTO_FMT = "Auto (%1$s)"
L.OPT_LANG_SET_FMT = "The stories will be in %1$s after the interface reloads."
L.OPT_LANG_PROFILE_FMT = "This profile reads the stories in %1$s. Type /reload to switch to it."
L.OPT_REPORT_PROBLEM = "Report a Problem"
L.OPT_REPORT_LINE_TIP = "Get a link to report a wrong story, a wrong reading or a mispronounced name."
L.OPT_REPORT_LINE_ADDRESS = "Copy this address and open it in your browser to report a problem with this entry."

--------------------------------------------------------------------------------
-- Player menu entries
--------------------------------------------------------------------------------

L.MENU_LORE_WINDOW = "Open Azeroth's Compendium"
L.OPEN_IN_LORE_TIP = "This place's story in Azeroth's Compendium, beside every other zone and area's."
L.MENU_ZONE_SETTINGS = "Places Settings"

--------------------------------------------------------------------------------
-- Lore window buttons
--------------------------------------------------------------------------------

L.AUDIO_READ_TIP = "Hear this story read aloud."
L.REPORT_BUTTON = "Report"
L.IN_ZONE_FMT = "In %1$s"
L.DISCOVERED_FMT = "%1$d of %2$d discovered"
L.ZONE_COUNT_FMT = "%1$d zones"
L.ZONE_COUNT_ONE = "1 zone"
L.CONTINENT_COUNT_FMT = "%1$d continents"
L.CONTINENT_COUNT_ONE = "1 continent"
L.OTHER_LANDS = "Other Lands"
L.BATTLEGROUNDS = "Battlegrounds"
-- The line over a zone's dungeons' and raids' cards where it has several: the Quests tab's words.
L.DUNGEONS = "Dungeons and Raids"
-- The window browses every place; the panel beside the map tells the zone it shows.
L.COMPENDIUM_PLACES = "Places"
L.LORE_PANEL_TITLE = "Place Story"
L.MAP_PANEL_EXPAND = "Show Place Story"
L.PANEL_SHOWN = "Show Story Beside Map: on"
L.PANEL_HIDDEN = "Show Story Beside Map: off"
L.LORE_SEARCH = "Search places"
L.LORE_DISCOVERED_ONLY = "Discovered Only"
L.LORE_VOICED_ONLY = "Voiced Only"
L.LORE_SEARCH_NONE = "Nothing matches."
L.MAP_LORE_FOR_FMT = "story for %1$s"

--------------------------------------------------------------------------------
-- Language names
--
-- How each content language is named in lists: the options dropdown, /spp lang,
-- pack labels. A picker lists every language at once, so these are exonyms in
-- the interface language rather than each language's own endonym.
--------------------------------------------------------------------------------

L.REASON_DISCOVERY = "Turn on Read Automatically to use this."
L.REASON_MAP_PANEL = "Turn on Show Story Beside Map to use this."
L.OPT_RESET_PAGE_CONFIRM = "Reset every Places setting to its default?"
L.OPT_RELOAD_NOW = "Reload Now"
L.OPT_LATER = "Later"



-- The page under Spoken in the game's settings.
L.OPT_PAGE_TITLE = "Places"
L.OPT_DEV_DEBUG = "Places Debug Messages"
L.OPT_DEV_PREVIEW = "Offer Unfinished Translations"

L.OPEN_IN_COMPENDIUM = "Open in Azeroth's Compendium"

SpokenZones:RegisterStrings("enUS", L)
