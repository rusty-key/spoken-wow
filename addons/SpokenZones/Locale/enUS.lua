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
L.PAUSE = "Pause"

L.PLAY_TOOLTIP = "Starts this lore again from the beginning."
L.PAUSE_TOOLTIP =
	"The game cannot resume a sound part-way through, so playing again starts from the beginning."

--------------------------------------------------------------------------------
-- Queue
--------------------------------------------------------------------------------

L.QUEUE_TITLE = "Up next"
L.QUEUE_COUNT = "%1$d waiting"
L.QUEUE_REMOVE_TOOLTIP = "Click to take this out of the queue."
L.QUEUE_DRAG_HINT = "Drag this list to move it."

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

L.BACK_TO_ZONE = "< Back to %1$s"
L.NO_LORE_FOR = "No lore recorded for %1$s yet."
-- A place the client has that the corpus knows about but nobody has written. Distinct
-- from NO_LORE_FOR, which is what an unknown place gets: this one we know exists.
L.LORE_NOT_WRITTEN = "%1$s is on the map, but nobody has written its lore yet."

--------------------------------------------------------------------------------
-- Slash commands
--------------------------------------------------------------------------------

L.CMD_HEADING = "commands (/spokenzones, or /spz):"
L.CMD_STATUS = "  /spz            -- status for the current zone and subzone"
L.CMD_OPTIONS = "  /spz options    -- open the settings panel"
L.CMD_WINDOW = "  /spz window     -- open the browsable lore window"
L.CMD_PANEL = "  /spz panel      -- toggle the world map panel"
L.CMD_HOVER = "  /spz hover      -- toggle the hover preview tooltip"
L.CMD_PLAY = "  /spz play       -- read the current lore aloud"
L.CMD_STOP = "  /spz stop       -- stop the narration"
L.CMD_VOICE = "  /spz voice      -- toggle narration on or off"
L.CMD_AUTOPLAY = "  /spz autoplay   -- toggle narrating areas as you discover them"
L.CMD_AUDIO = "  /spz audio      -- list sound packs, or switch with /spz audio <name>"
L.CMD_LANG = "  /spz lang       -- list languages, or switch with /spz lang <code> or auto"
L.CMD_DISCOVER = "  /spz discover   -- pretend to discover an area (dev)"
L.CMD_FORGET = "  /spz forget     -- forget what this character has been narrated"
L.CMD_BAR = "  /spz bar        -- move the player back to the middle of the screen"
L.CMD_MINIMAP = "  /spz minimap    -- show or hide the minimap button"
L.CMD_DEBUG = "  /spz debug      -- report area names on map click"
L.CMD_VERIFY = "  /spz verify     -- check data against this client"
L.CMD_DUMP = "  /spz dump       -- enumerate the map tree (dev)"

--------------------------------------------------------------------------------
-- Options panel
--------------------------------------------------------------------------------

L.OPT_NOTE = "Lore for zones and subzones on the world map and minimap. Text from warcraft.wiki.gg, CC BY-SA 4.0."
L.OPT_SECTION_MAP = "World map"
L.OPT_MAP_PANEL = "Show the lore panel beside the map"
L.OPT_MAP_PANEL_TIP = "The panel is hidden while the map is maximised, since it would sit off-screen."
L.OPT_HOVER = "Show a lore tooltip on hover"
L.OPT_HOVER_TIP = "Hover a zone on a continent map, or a subzone on a zone map. Suppressed while the cursor is over a map pin."
L.OPT_PANEL_LEFT = "Put the panel on the left of the map"
L.OPT_PANEL_WIDTH = "Panel width"
L.OPT_FONT_SIZE = "Font size"
L.OPT_SECTION_MINIMAP = "Minimap"
L.OPT_MINIMAP_BUTTON = "Show the minimap button"
L.OPT_MINIMAP_BUTTON_TIP = "Left-click opens the lore window, right-click opens these settings."
L.OPT_SECTION_NARRATION = "Narration"
L.OPT_PLAY_BUTTON = "Show the Play button on lore descriptions"
L.OPT_PLAY_BUTTON_TIP = "Reads the lore aloud. Needs a Spoken Zones Audio companion addon; without one the button does not appear."
L.OPT_AUTOPLAY = "Narrate a zone when you discover it"
L.OPT_AUTOPLAY_TIP = "Triggered by the game's own discovery -- the moment it prints \"Discovered Durotar\". Fires once per character, because that is when the game fires it."
L.OPT_AUTOPLAY_SUB = "Also narrate subzones you discover"
L.OPT_AUTOPLAY_SUB_TIP = "Most discoveries are subzones -- a walk across Elwynn sets off several. They queue rather than interrupt, so untick this only if the narration feels constant."
L.OPT_AUTOPLAY_EXPLORED = "Also narrate areas you explored before installing"
L.OPT_AUTOPLAY_EXPLORED_TIP = "The game announces a discovery once per character, ever -- so a character who already explored Azeroth is never narrated anything. Tick this and Spoken Zones keeps its own record instead, still one clip per area per character. /spz forget clears it."
L.OPT_PACK_NONE = "Nothing is narrated. Install Spoken Zones Audio to hear the lore read aloud."
L.OPT_PACK_MULTI_FMT = "%1$s. %2$d installed; the one in the language you are reading plays unless you choose another."
L.OPT_SOUND_PACK = "Sound pack"
L.OPT_SOUND_PACK_TIP = "Which installed pack narrates the lore."
L.OPT_SECTION_LANGUAGE = "Language"
L.OPT_LANG_ONLY_ENGLISH = "The lore is only written in English so far."
L.OPT_LANG_RELOAD = "Reload to start reading it: type /reload."
L.OPT_LANG_COUNT_FMT = "%1$d languages available. Switching takes effect after /reload."
L.OPT_LANGUAGE = "Language"
L.OPT_LANGUAGE_TIP = "Which language the lore is read and shown in. Auto follows your game's language (English until it is translated); a language picked here stays whatever language the game runs in."
L.OPT_LANG_AUTO_FMT = "Auto (%1$s)"
L.OPT_LANG_SET_FMT = "language set to %1$s -- |cffffcc00/reload to apply|r"
L.OPT_SECTION_TROUBLE = "Troubleshooting"
L.OPT_DEBUG_MAP_CLICK = "Report area names when clicking the map"
L.OPT_DEBUG_MAP_CLICK_TIP = "Prints the raw area name the client reports, the key it normalises to, and whether lore was found. Use this to spot a subzone needing an alias."
L.OPT_SECTION_FEEDBACK = "Feedback"
L.OPT_REPORT_PROBLEM = "Report a problem"
L.OPT_REPORT_ADDRESS = "Copy this address and open it in your browser to send feedback about Spoken Zones."
L.OPT_REPORT_NOTE = "There is a Report button on each lore entry for problems with that entry. This one is for everything else. The game cannot open a link, so both give you an address to copy."
L.OPT_REPORT_LINE_TIP = "Wrong lore, a bad reading, a mispronounced name -- this gives you a link to say so."
L.OPT_REPORT_LINE_ADDRESS = "Copy this address and open it in your browser to report a problem with this entry."

--------------------------------------------------------------------------------
-- Player menu entries
--------------------------------------------------------------------------------

L.MENU_LORE_WINDOW = "Open lore window"
L.MENU_ZONE_SETTINGS = "Spoken Zones settings"

--------------------------------------------------------------------------------
-- Lore window buttons
--------------------------------------------------------------------------------

L.STOP = "Stop"
L.AUDIO_STOP_TIP = "Stop the narration"
L.AUDIO_READ_TIP = "Read this lore aloud"
L.REPORT_BUTTON = "Report"
L.CONTRIBUTE_BUTTON = "Contribute"
L.CONTRIBUTE_BUTTON_TIP_TITLE = "Spoken Zones has no lore for this place"
L.CONTRIBUTE_BUTTON_TIP = "Contribute by describing it: what it is, who lives there, what happened there."
L.IN_ZONE_FMT = "in %1$s"
L.SUBZONE_COUNT_FMT = "%1$d subzones"
L.LORE_WINDOW_EMPTY = "Pick a zone on the left. Zones with subzones show a count; click one to expand it."
L.MAP_LORE_FOR_FMT = "lore for %1$s"
L.MAP_SUBZONE_MORE = "click a subzone on the map for more"

--------------------------------------------------------------------------------
-- Language names
--
-- How each content language is named in lists: the options dropdown, /spz lang,
-- pack labels. A picker lists every language at once, so these are exonyms in
-- the interface language rather than each language's own endonym.
--------------------------------------------------------------------------------

L.OPT_PACK_NONE_INSTALLED = "none installed"

SpokenZones:RegisterStrings("enUS", L)
