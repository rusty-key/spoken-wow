if not (VoiceOver and VoiceOver.SpokenDialogue) then return end
setfenv(1, VoiceOver)

-- Interface strings for the Spoken Quests options and quest-window buttons, and the
-- key set every other language is measured against.
--
-- Only the files listed below draw their text from here so far; the rest still
-- hold English literals. Chat and diagnostics prints are deliberately not among
-- them: those answer bug reports, where one language beats nine translations.
--
--   Options.lua            General and sound-pack tabs of the options window
--   UI/SettingsPanel.lua   the same settings on the interface-settings canvas
--   UI/DialogPlayButton.lua  why the quest window did not read itself
--   Compatibility.lua      Play/Stop, Contribute and Report on the quest-log details panel
--   Player.lua             minimap menu entries and player settings link
--
-- What the gossip module shows too -- the windows' Listen and Contribute buttons, the Report
-- action and its dialog -- is the dialogue core's, in Spoken's strings (DIALOGUE_*).
--
-- FORMAT ARGUMENTS ARE POSITIONAL (%1$s, %2$d), even where there is only one and
-- the position is obvious. Word order is the thing a translator most often has to
-- change and least often can.
--
-- A locale file per language overlays this table (Locale/<code>.lua), so anything
-- missing falls back to English at runtime.

L = {}

--------------------------------------------------------------------------------
-- Options window: General tab
--------------------------------------------------------------------------------

L.OPT_GROUP_GENERAL = "General"
L.OPT_GROUP_AUDIO = "Audio"
L.OPT_AUTOPLAY = "Read Dialogue When It Opens"
L.OPT_AUTOPLAY_TIP = "Quest windows. Off, nothing is read until you press Listen on the window or type /spq read."
L.OPT_SYNC_WINDOW = "Sync Dialog to Window State"
L.OPT_SYNC_WINDOW_TIP = "Narration will automatically stop when the quest window is closed."
L.OPT_SECTION_LANGUAGE = "Language"
L.OPT_VOICE_LANGUAGE = "Voice Language"
L.OPT_VOICE_LANGUAGE_TIP = "Which language the voices speak. Auto uses your game's language. A language is only heard if its voice pack is installed."
L.OPT_LANG_AUTO_FMT = "Auto (%1$s)"
L.OPT_FALLBACK_LANGUAGE = "If a Line Is Missing"
L.OPT_FALLBACK_LANGUAGE_TIP = "What to play when the voice pack in your language has no recording of a line: the same line in another language, or nothing."
L.OPT_FALLBACK_NONE = "Stay Silent"
L.OPT_FOLLOWUP = "Experimental: Enable Quest Follow-ups"
L.OPT_FOLLOWUP_TIP = "Some NPCs speak in chat after you accept or turn in a quest. Only lines your own quest set off are read, never another player's."
L.OPT_GROUP_DEBUG = "Debugging Tools"
L.OPT_DEBUG = "Enable Debug Messages"
L.OPT_DEBUG_TIP = "Enables printing of some \"useful\" debug messages to the chat window."
-- Spoken > Developer: every quest line taken for one no pack has (DataModules:PrepareSound).
L.OPT_DEV_MOCK_MISSING = "Mock Missing Voice Over"
L.OPT_DEV_MOCK_MISSING_TIP = "Treat every quest line as one no installed pack has: nothing plays when a quest opens, the Play buttons find nothing, and the link to report the missing voice-over appears. Shows how a quest without a voice-over looks. Stays on until turned off; Spoken Quests reminds you at login."
L.OPT_DEV_MOCK_ON = "Mock Missing Voice Over is on: no quest line plays. Turn it off in Spoken > Developer."

--------------------------------------------------------------------------------
-- Options window: sound-pack tab
--------------------------------------------------------------------------------

L.OPT_AVAILABLE_GROUP = "|cFF00CCFFAvailable|r"
L.OPT_ROW_ADDON_NAME = "Addon Name"
L.OPT_ROW_TITLE = "Title"
L.OPT_ROW_FORMAT_VERSION = "Module Data Format Version"
L.OPT_ROW_PRIORITY = "Module Priority"
L.OPT_ROW_LANGUAGE = "Language"
L.OPT_ROW_CONTENT_VERSION = "Content Version"
L.OPT_ROW_LOAD_ON_DEMAND = "Load on Demand"
L.OPT_ROW_LOADED = "Is Loaded"
L.OPT_ROW_REASON_FMT = "%1$sReason: |r%2$s%3$s|r"
L.OPT_LOAD_BUTTON = "Load"
L.OPT_DOWNLOAD_URL = "Download URL"
L.OPT_UPDATE_SUFFIX = " (Update)"
L.OPT_NOT_LOADED_SUFFIX = " (not loaded)"
-- After the tab name while packs are waiting to be installed.
L.OPT_NEW_SUFFIX = " (NEW)"
L.OPT_PACK_LOADED = "Installed"
L.OPT_PACK_NOT_LOADED = "Not loaded"
L.OPT_CONTENT_VERSION_FMT = "%1$s"
L.OPT_CONTENT_VERSION_UPDATE_FMT = "%2$s -> |cFF00CCFF%1$s|r"

--------------------------------------------------------------------------------
-- Slash commands (also listed in the options window)
--------------------------------------------------------------------------------

L.OPT_CMD_GROUP = "Commands"
L.OPT_STOP = "Stop"
L.OPT_STOP_TIP = "Stops this quest's line. Replay starts it again from the beginning."
L.OPT_REPLAY = "Replay"
L.OPT_REPLAY_TIP = "Plays this quest's line again from the beginning."
L.OPT_CMD_PLAYPAUSE = "Stop or Replay Audio"
L.OPT_CMD_PLAYPAUSE_DESC = "Stops the line, or plays a stopped one again from the beginning"
L.OPT_CMD_PAUSE = "Stop Audio"
L.OPT_CMD_PAUSE_DESC = "Stops the line being read"
L.OPT_CMD_PLAY = "Play Audio"
L.OPT_CMD_PLAY_DESC = "Plays a stopped line again from the beginning"
L.OPT_CMD_SKIP = "Skip Line"
L.OPT_CMD_SKIP_DESC = "Skips the line being read"
L.OPT_CMD_CLEAR = "Clear Queue"
L.OPT_CMD_CLEAR_DESC = "Stops playback and empties the queue"
L.OPT_CMD_READ = "Read Visible Quest"
L.OPT_CMD_READ_DESC = "Reads the quest window that is open"
L.OPT_CMD_TEST = "Test Audio"
L.OPT_CMD_TEST_DESC = "Plays a known quest line to check that you can hear it"
L.OPT_CMD_FOLLOWUP = "Follow-up"
L.OPT_CMD_FOLLOWUP_DESC = "Replay a quest's follow-up NPC lines as if you had just turned it in (or accepted it, with start): /spq followup <questID> [start]"
L.OPT_CMD_DIAG = "Diagnostics"
L.OPT_CMD_DIAG_DESC = "Prints client, API and voice pack status"
L.OPT_CMD_OPTIONS = "Open Options"
L.OPT_CMD_OPTIONS_DESC = "Opens or closes the options window"

--------------------------------------------------------------------------------
-- Interface-settings canvas
--------------------------------------------------------------------------------

L.OPT_PANEL_NOTE = "Voices for quest givers. Volume, language, the window and subtitles are on the Spoken page, since they cover every module."
L.OPT_SECTION_DIALOGUE = "When to Read"
L.OPT_PANEL_AUTOPLAY = "Read Automatically"
L.OPT_PANEL_AUTOPLAY_TIP = "Reads quests as soon as their window opens. Off, nothing starts by itself: press Listen on the window, or type /spq read."
L.OPT_PANEL_STOP_ON_CLOSE = "Stop When Window Closes"
L.OPT_PANEL_STOP_ON_CLOSE_TIP = "Stops the voice as soon as you close the quest window."
L.OPT_PANEL_FOLLOWUP = "Follow-up Lines"
L.OPT_PANEL_FOLLOWUP_TIP = L.OPT_FOLLOWUP_TIP
L.OPT_SECTION_PACKS = "Voice Packs"
L.OPT_NO_PACK = "|cffff8080No voice pack installed.|r Nothing is read aloud without one."
L.OPT_COPY_ADDRESS_FMT = "Shows the address to copy into your web browser: %1$s"
L.OPT_SECTION_TROUBLE = "Fix a Problem"
L.OPT_TEST_LINE = "Play a Test Line"
L.OPT_TEST_LINE_TIP = "Plays a line Spoken Quests knows it has, the same way a real one plays, to check that you can hear it."
L.OPT_PRINT_DIAG = "Show Diagnostics"
L.OPT_REPORT_PROBLEM = "Report a Problem"
L.OPT_REPORT_QUEST_TIP = "Get a link to report a wrong reading or a mispronounced name."
L.OPT_REPORT_PROBLEM_TIP = "For anything that isn't about one line; each line has its own Report button. Gives you an address to copy into your web browser."
L.OPT_PRINT_DIAG_TIP = "Lists your game version, sound settings and installed voice packs in chat, for a bug report."
L.OPT_RESET_PROFILE = "Reset Quests Settings"
L.OPT_RESET_PROFILE_TIP = "Puts every setting on this page back to its default, in the profile in use."
L.OPT_PACK_ALL = "All Quests"
L.OPT_PACK_ALLIANCE = "Alliance Quests"
L.OPT_PACK_HORDE = "Horde Quests"
L.OPT_PACK_SHARED = "Shared Quests"
L.OPT_PACK_GOSSIP = "Gossip"
-- A pack by name, as the settings list them: "Voice Pack (Horde Quests)".
L.OPT_PACK_NAME_FMT = "Voice Pack (%1$s)"
L.OPT_PACK_INCLUDED = "In All Quests"
L.OPT_DOWNLOAD = "Download"

--------------------------------------------------------------------------------
-- Quest and gossip windows
--------------------------------------------------------------------------------

L.OPT_PLAY = "Play"
-- The quest window's worded button, where a word has to say what it does.
L.OPT_PLAY_TIP = "Hear this quest read aloud."
-- The window's Stop removes the line; the quest log's Stop (OPT_STOP_TIP) keeps it for Replay.
L.OPT_AUTOPLAY_OFF_TIP = "Read Automatically is turned off on the Quests page of the Spoken settings."
L.OPT_CONTRIBUTE = "Contribute"

--------------------------------------------------------------------------------
-- Minimap menu and player settings link
--------------------------------------------------------------------------------

L.OPT_MINIMAP_SETTINGS = "Quests Settings"

-- The page under Spoken in the game's settings.
L.OPT_PAGE_TITLE = "Quests"

L.OPT_PART_SWITCH = "Enable Module"
L.OPT_PART_SWITCH_TIP = "Turns quest voices on or off. Off, the module stays installed but reads nothing. The same switch is on the Spoken page."
L.REASON_PART_OFF = "Turn on Enable Module at the top of this page to use this."
L.REASON_AUTOPLAY = "Turn on Read Automatically to use this."
L.OPT_RESET_PROFILE_CONFIRM = "Reset every Quests setting in the profile in use to its default?"
L.OPT_RESET = "Reset"
L.OPT_CANCEL = "Cancel"


L.OPT_SECTION_EXTRAS = "Extras"
L.OPT_SECTION_DIALOGUEUI = "DialogueUI"
L.OPT_DUI_NOTE = "For the DialogueUI addon, whose window replaces the quest and gossip frames and hides the rest of the interface while it is open."
L.OPT_DUI_CAPTIONS = "Mark the Words Being Read"
L.OPT_DUI_CAPTIONS_TIP = "In DialogueUI's quest and gossip text, the words follow the line as Spoken's captions do. Whether they type out, light up or both is set on Spoken's page: Type Words Out and Highlight Words."
L.OPT_DUI_AUTOSCROLL = "Keep the Words in View"
L.OPT_DUI_AUTOSCROLL_TIP = "Scrolls DialogueUI's text when the words being read move out of sight."
L.OPT_DUI_SHOW_PLAYER = "Show Spoken Over DialogueUI"
L.OPT_DUI_SHOW_PLAYER_TIP = "DialogueUI hides the rest of the interface while it is open, Spoken's window or subtitles with it. On, they stay on screen where you put them, and can still be moved."
L.OPT_DUI_PLAY_BUTTON = "Play Button on DialogueUI"
L.OPT_DUI_PLAY_BUTTON_TIP = "Spoken Quests' Play button at the top right of DialogueUI's window, whether or not DialogueUI's Text To Speech is on, greyed on pages with no recording. Left-click plays the line or stops it. Right-click turns Read Automatically on or off. With DialogueUI's Text To Speech on, its own button plays the recording too."
L.OPT_DUI_ON = "On"
L.OPT_DUI_OFF = "Off"
L.OPT_DUI_PLAY_RIGHT_CLICK = "Right-click to turn Read Automatically on or off."
L.OPT_DUI_MISSING = "DialogueUI is not loaded."
L.OPT_DUI_NO_PLAYER = "Needs the Spoken addon."
L.OPT_DUI_OLD_PLAYER = "Needs a newer Spoken."
L.OPT_DUI_UNKNOWN = "This version of DialogueUI is not recognised."
L.REASON_DUI_CAPTIONS = "Turn on Mark the Words Being Read to use this."

L.OPT_SECTION_START_OVER = "Start Over"
