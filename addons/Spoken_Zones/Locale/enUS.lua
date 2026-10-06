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
--   Core.lua             the /spz command list

local _, SpokenZones = ...

local L = {}

--------------------------------------------------------------------------------
-- Playback controls
--------------------------------------------------------------------------------

L.PLAY = "Play"
L.STOP = "Stop"
L.STOP_TOOLTIP = "Stops the story. Replay reads it from the beginning."
L.REPLAY = "Replay"
L.REPLAY_TOOLTIP = "Reads the story again from the beginning."


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

L.NO_LORE_FOR = "No lore recorded for %1$s yet."
-- A place the client has that the corpus knows about but nobody has written. Distinct
-- from NO_LORE_FOR, which is what an unknown place gets: this one we know exists.
L.LORE_NOT_WRITTEN = "%1$s is on the map, but nobody has written its lore yet."

--------------------------------------------------------------------------------
-- Slash commands
--------------------------------------------------------------------------------

L.CMD_HEADING = "commands (/spokenzones, or /spz):"
L.CMD_STATUS = "  /spz            -- status for the current zone and area"
L.CMD_OPTIONS = "  /spz options    -- open the settings panel"
L.CMD_WINDOW = "  /spz window     -- open Lore of Azeroth"
L.CMD_PANEL = "  /spz panel      -- show or hide Zone Lore beside the map"
L.CMD_HOVER = "  /spz hover      -- turn Story on Hover on or off"
L.CMD_PLAY = "  /spz play       -- read the current lore aloud"
L.CMD_STOP = "  /spz stop       -- stop the narration"
L.CMD_VOICE = "  /spz voice      -- toggle narration on or off"
L.CMD_AUTOPLAY = "  /spz autoplay   -- toggle narrating areas as you discover them"
L.CMD_AUDIO = "  /spz audio      -- list voice packs, or switch with /spz audio <name>"
L.CMD_LANG = "  /spz lang       -- list languages, or switch with /spz lang <code> or auto"
L.CMD_DISCOVER = "  /spz discover   -- pretend to discover an area (dev)"
L.CMD_FORGET = "  /spz forget     -- forget what this character has been narrated"
L.CMD_MINIMAP = "  /spz minimap    -- show or hide the minimap button"
L.CMD_DEBUG = "  /spz debug      -- report area names on map click"
L.CMD_VERIFY = "  /spz verify     -- check data against this client"
L.CMD_DUMP = "  /spz dump       -- enumerate the map tree (dev)"

--------------------------------------------------------------------------------
-- Options panel
--------------------------------------------------------------------------------

L.OPT_NOTE = "Stories about the zones and areas you visit, read aloud and shown on the world map."
L.OPT_SECTION_MAP = "World Map"
L.OPT_MAP_PANEL = "Zone Lore Beside Map"
L.OPT_MAP_PANEL_TIP = "Shows Zone Lore, the story of the zone or area you are looking at, beside the world map. Hidden while the map fills the screen."
L.OPT_HOVER = "Story on Hover"
L.OPT_HOVER_TIP = "Shows an area's story when you point at it: a zone on a continent map, or a smaller area on a zone map. Not shown while you point at a map pin."
L.OPT_PICTURES = "Show Pictures"
L.OPT_PICTURES_TIP = "Shows a picture of the place above its story."
L.OPT_PANEL_WIDTH = "Zone Lore Width"
L.OPT_FONT_SIZE = "Text Size"
L.OPT_SECTION_NARRATION = "When to Read"
L.OPT_PLAY_BUTTON = "Read Stories Aloud"
L.OPT_PLAY_BUTTON_TIP = "Reads the stories aloud: when you discover a place, and from the Play button beside each story in Zone Lore and Lore of Azeroth. Off, the stories still show, as text only."
L.REASON_VOICE = "Turn on Read Stories Aloud to use this."
L.OPT_AUTOPLAY = "Read on Discovery"
L.OPT_AUTOPLAY_TIP = "Reads an area's story the moment the game says you discovered it, such as \"Discovered Durotar\". The game does this once per place for each character."
L.OPT_AUTOPLAY_SUB = "Include Smaller Areas"
L.OPT_AUTOPLAY_SUB_TIP = "Also reads the smaller areas inside a zone as you find them. A walk across Elwynn Forest finds several; they play one after another rather than cutting each other off."
L.OPT_AUTOPLAY_EXPLORED = "Include Places Found Before"
L.OPT_AUTOPLAY_EXPLORED_TIP = "The game only announces a discovery once, so a character who has explored already would hear nothing. With this on, Spoken Zones keeps its own list instead: one story per place for each character. Forget Places Read, below, clears it."
L.OPT_SOUND_PACK = "Reads With"
L.OPT_SOUND_PACK_TIP = "Which installed voice pack reads the stories."
L.OPT_SECTION_LANGUAGE = "Language"
L.OPT_SECTION_PACKS = "Voice Packs"
L.OPT_SECTION_HISTORY = "Reading History"
L.OPT_FORGET_PLACES = "Forget Places Read"
L.OPT_FORGET_PLACES_TIP = "Clears this character's list of places it has heard. The story for where you stand plays again at your next login, and with Include Places Found Before on, every place counts as unheard again."
L.OPT_FORGET_PLACES_DONE = "This character's list of places read is cleared."
L.OPT_PACK_NAME_FMT = "Voice Pack (%1$s)"
L.OPT_PACK_OFFICIAL = "Zones"
L.OPT_PACK_INSTALLED = "Installed"
L.OPT_DOWNLOAD = "Download"
L.OPT_DOWNLOAD_TIP = "Shows the address to copy into your web browser."
L.OPT_DOWNLOAD_ADDRESS = "Copy this address into your web browser to download the voice pack."
L.OPT_LANG_RELOAD = "Type /reload to switch to it."
L.OPT_LANG_COUNT_FMT = "%1$d languages available. A change applies after you type /reload."
L.OPT_LANGUAGE = "Story Language"
L.OPT_LANGUAGE_TIP = "Auto follows your game's language, or English where there is no translation yet. A language picked here stays, whatever language the game is in."
L.OPT_LANG_AUTO_FMT = "Auto (%1$s)"
L.OPT_LANG_SET_FMT = "The stories will be in %1$s after the interface reloads."
L.OPT_SECTION_TROUBLE = "Fix a Problem"
L.OPT_TEST_LINE = "Play a Test Line"
L.OPT_TEST_LINE_TIP = "Plays a story, the same way a real one plays, to check that you can hear it: the one for where you stand, or another from your voice pack."
L.OPT_DIAGNOSTICS = "Show Diagnostics"
L.OPT_DIAGNOSTICS_TIP = "Lists your voice packs and reading settings in chat, for a bug report."
L.OPT_REPORT_PROBLEM = "Report a Problem"
L.OPT_REPORT_ADDRESS = "Copy this address and open it in your browser to send feedback about Spoken Zones."
L.OPT_REPORT_NOTE = "For anything that isn't about one story; each story has its own Report button. Gives you an address to copy into your web browser."
L.OPT_REPORT_LINE_TIP = "Wrong lore, a bad reading, a mispronounced name -- this gives you a link to say so."
L.OPT_REPORT_LINE_ADDRESS = "Copy this address and open it in your browser to report a problem with this entry."

--------------------------------------------------------------------------------
-- Player menu entries
--------------------------------------------------------------------------------

L.MENU_LORE_WINDOW = "Open Lore of Azeroth"
L.OPEN_IN_LORE_TIP = "This place's story in Lore of Azeroth, beside every other zone and area's."
L.OPT_SECTION_LORE = "Lore of Azeroth"
L.OPT_LORE_WINDOW_TIP = "Every zone and area's story, to browse and listen to wherever you are."
L.MENU_ZONE_SETTINGS = "Zones Settings"

--------------------------------------------------------------------------------
-- Lore window buttons
--------------------------------------------------------------------------------

L.AUDIO_READ_TIP = "Hear this story read aloud"
L.REPORT_BUTTON = "Report"
L.CONTRIBUTE_BUTTON = "Contribute"
L.CONTRIBUTE_BUTTON_TIP_TITLE = "Spoken Zones has no lore for this place"
L.CONTRIBUTE_BUTTON_TIP = "Contribute by describing it: what it is, who lives there, what happened there."
L.IN_ZONE_FMT = "in %1$s"
L.SUBZONE_COUNT_FMT = "%1$d areas"
L.SUBZONE_COUNT_ONE = "1 area"
L.ZONE_COUNT_FMT = "%1$d zones"
L.ZONE_COUNT_ONE = "1 zone"
L.CONTINENT_COUNT_FMT = "%1$d continents"
L.CONTINENT_COUNT_ONE = "1 continent"
L.LORE_WINDOW_EMPTY = "Choose a place on the left to read its story. A zone's number is how many smaller areas it has; click it to see them."
-- The window browses every place; the panel beside the map tells the zone it shows.
L.LORE_WINDOW_TITLE = "Lore of Azeroth"
L.LORE_PANEL_TITLE = "Zone Lore"
L.MAP_PANEL_EXPAND = "Show Zone Lore"
L.PANEL_SHOWN = "Zone Lore beside the map: on"
L.PANEL_HIDDEN = "Zone Lore beside the map: off"
L.MINIMAP_LEFT_CLICK = "|cff66bbffLeft-click|r %1$s"
L.LORE_SEARCH = "Search places"
L.LORE_SEARCH_NONE = "No place matches."
L.LORE_PICK = "Every place's story"
L.MAP_LORE_FOR_FMT = "lore for %1$s"

--------------------------------------------------------------------------------
-- Language names
--
-- How each content language is named in lists: the options dropdown, /spz lang,
-- pack labels. A picker lists every language at once, so these are exonyms in
-- the interface language rather than each language's own endonym.
--------------------------------------------------------------------------------

L.OPT_PACK_NONE_INSTALLED = "none installed"
L.OPT_PART_SWITCH = "Enable Module"
L.OPT_PART_SWITCH_TIP = "Turns reading zone and area stories on or off. Off, the module stays installed but reads nothing. The same switch is on the Spoken page."
L.REASON_PART_OFF = "Turn on Enable Module at the top of this page to use this."
L.REASON_DISCOVERY = "Turn on Read on Discovery to use this."
L.REASON_MAP_PANEL = "Turn on Zone Lore Beside Map to use this."
L.OPT_PANEL_WIDTH_TIP = "How wide Zone Lore is beside the map."
L.OPT_FONT_SIZE_TIP = "How big the words of the stories are, in Zone Lore and Lore of Azeroth."
L.OPT_RESET_PAGE = "Reset Zones Settings"
L.OPT_RESET_PAGE_TIP = "Puts this page's settings back to their defaults. Also turns /spz debug off, shows the minimap button again (when Spoken isn't installed) and stops previewing unfinished translations. The story language, the voice pack chosen under Reads With and the list of places already read are kept."
L.OPT_RESET_PAGE_CONFIRM = "Reset every Zones setting to its default?"
L.OPT_RESET = "Reset"
L.OPT_CANCEL = "Cancel"
L.OPT_RELOAD_NOW = "Reload Now"
L.OPT_LATER = "Later"

L.OPT_SECTION_START_OVER = "Start Over"


-- The page under Spoken in the game's settings.
L.OPT_PAGE_TITLE = "Zones"

SpokenZones:RegisterStrings("enUS", L)
