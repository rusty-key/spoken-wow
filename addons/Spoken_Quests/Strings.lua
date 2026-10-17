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
--   UI/DialogPlayButton.lua  Play/Stop button on quest and gossip windows
--   Compatibility.lua      Play/Stop button on the quest-log details panel
--   UI/ContributeButton.lua  Contribute button on quest and gossip windows
--   Contribute.lua         Contribute button tooltip
--   ReportButton.lua       the copy-link dialog for reporting a line
--   Player.lua             minimap menu entries and player settings link
--   UI/QuestsTab.lua       the Quests tab of Azeroth's Compendium
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
L.OPT_DEBUG = "Quests Debug Messages"
-- Spoken > Developer: every quest line taken for one no pack has (DataModules:PrepareSound).
L.OPT_DEV_MOCK_MISSING = "Mock Missing Voice Over"
L.OPT_DEV_MOCK_MISSING_TIP = "No quest line plays, to show a quest without a voice."
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
L.OPT_CMD_SKIP = "Skip Line"
L.OPT_CMD_SKIP_DESC = "Skips the line being read"
L.OPT_CMD_READ = "Read Visible Quest"
L.OPT_CMD_READ_DESC = "Reads the quest window that is open"
L.OPT_CMD_TEST = "Play a Test Line"
L.OPT_CMD_TEST_DESC = "Plays a known quest line to check that you can hear it"
L.OPT_CMD_FOLLOWUP = "Follow-up"
L.OPT_CMD_FOLLOWUP_DESC = "Replay a quest's follow-up NPC lines as if you had just turned it in (or accepted it, with start): /spq followup <questID> [start]"
L.OPT_CMD_DIAG = "Show Diagnostics"
L.OPT_CMD_DIAG_DESC = "Prints client, API and voice pack status"
L.OPT_CMD_OPTIONS = "Settings"
L.OPT_CMD_OPTIONS_DESC = "Opens this module's settings page"

--------------------------------------------------------------------------------
-- Interface-settings canvas
--------------------------------------------------------------------------------

L.OPT_PANEL_AUTOPLAY = "Read Automatically"
L.OPT_PANEL_STOP_ON_CLOSE = "Stop When Window Closes"
L.OPT_PANEL_READ_AFTER_CLOSE = "Read When Window Closes"
L.OPT_PANEL_FOLLOWUP = "Read NPC Chat After Quests"
L.OPT_PANEL_GREETINGS = "Read Greetings"
L.OPT_GREETING_LABEL_ALWAYS = "Every Time"
L.OPT_GREETING_LABEL_ONCE_QUEST = "Once for Quest Givers"
L.OPT_GREETING_LABEL_ONCE_NPC = "Once per NPC"
L.OPT_GREETING_LABEL_NEVER = "Never"
L.OPT_OG_THRALL = "Original Thrall Speech"
L.OPT_OG_THRALL_TIP = "Plays AI VoiceOver's recording of Thrall's speech instead of Spoken's."
L.OPT_FORGET_GREETINGS = "Forget Greetings Heard"
L.REASON_FORGET_GREETINGS = "Set Read Greetings to Once per NPC or Once for Quest Givers to use this."
L.OPT_FORGET_GREETINGS_DONE = "This character's list of greetings heard is cleared."
L.OPT_PANEL_GAME_GREETING_FIRST = "NPC Voice Before Reading"
L.OPT_PANEL_GAME_GREETING_FIRST_TIP = "Waits for the NPC's own voice to finish before reading."
L.OPT_PANEL_QUEST_PLAY = "Read When Questing"
L.OPT_PANEL_QUEST_PLAY_TIP = "Reads quests when you first arrive in their area on the minimap, or when you first accomplish an objective, whichever happens first."
L.GREETING_DIALOG_APART = "Spoken: Dialog volume set to %1$d%%, apart from the other volume sliders, so NPC Voice Before Reading can tell when an NPC has finished speaking."
L.QUEUE_HELD_GREETING = "Waiting for the NPC to finish speaking."
L.OPT_SECTION_PACKS = "Voice Packs"
L.OPT_REPORT_PROBLEM = "Report a Problem"
L.OPT_REPORT_QUEST_TIP = "Get a link to report a wrong reading or a mispronounced name."
L.OPT_PACK_ALL = "All Quests"
L.OPT_PACK_ALLIANCE = "English (Alliance)"
L.OPT_PACK_HORDE = "English (Horde)"
L.OPT_PACK_SHARED = "English (Shared)"
L.OPT_PACK_GOSSIP = "Gossip"
-- A pack by name, as the settings list them: "Voice Pack (Horde Quests)".
L.OPT_PACK_INCLUDED = "In All Quests"

--------------------------------------------------------------------------------
-- Quest and gossip windows
--------------------------------------------------------------------------------

L.OPT_PLAY = "Play"
-- The quest window's worded button, where a word has to say what it does.
L.OPT_LISTEN = "Listen"
L.OPT_PLAY_TIP = "Hear this quest read aloud."
-- The window's Stop removes the line; the quest log's Stop (OPT_STOP_TIP) keeps it for Replay.
L.OPT_DIALOG_STOP_TIP = "Stop reading"
L.OPT_READ_TIP = "Read this aloud"
L.OPT_GREETING = "Greeting"
L.OPT_AUTOPLAY_OFF_TIP = "Read Automatically is turned off on the Quests page of the Spoken settings."
L.OPT_NEVER_TIP = "Read Greetings is set to Never on the Gossip page of the Spoken settings."
L.OPT_CONTRIBUTE = "Contribute"
L.OPT_REPORT = "Report"
L.OPT_CONTRIBUTE_TIP_LINE = "Spoken Quests doesn't have this line"
L.OPT_CONTRIBUTE_TIP_QUEST = "Spoken Quests doesn't have this quest"
L.OPT_CONTRIBUTE_TIP_SHARE = "Contribute your data by sharing data from your client"
L.OPT_REPORT_COPY = "Spoken Quests|n|nCopy this address and open it in your web browser."

--------------------------------------------------------------------------------
-- Minimap menu and player settings link
--------------------------------------------------------------------------------

L.OPT_MINIMAP_SETTINGS = "Quests Settings"

-- The page under Spoken in the game's settings.
L.OPT_PAGE_TITLE = "Quests"

L.OPT_GOSSIP_PAGE_TITLE = "Gossip"
L.OPT_GOSSIP_MINIMAP_SETTINGS = "Gossip Settings"
L.REASON_AUTOPLAY = "Turn on Read Automatically to use this."
L.REASON_AUTOPLAY_ON_QUESTS = "Turn on Read Automatically on the Quests page to use this."
L.OPT_RESET_PROFILE_CONFIRM = "Reset every Quests and Gossip setting in the profile in use to its default?"
L.OPT_CANCEL = "Cancel"


L.OPT_SECTION_DIALOGUEUI = "DialogueUI"
L.OPT_DUI_CAPTIONS = "Mark Words in DialogueUI"
L.OPT_DUI_CAPTIONS_TIP = "Types out or highlights DialogueUI's text, as set under Words."
L.OPT_DUI_AUTOSCROLL = "Keep the Words in View"
L.OPT_DUI_SHOW_PLAYER = "Show Spoken Over DialogueUI"
L.OPT_DUI_PLAY_BUTTON = "Listen Button on DialogueUI"
L.OPT_DUI_ON = "On"
L.OPT_DUI_OFF = "Off"
L.OPT_DUI_PLAY_RIGHT_CLICK = "Right-click to turn Read Automatically on or off."
L.OPT_DUI_MISSING = "DialogueUI is not loaded."
L.OPT_DUI_NO_PLAYER = "Needs the Spoken addon."
L.OPT_DUI_OLD_PLAYER = "Needs a newer Spoken."
L.OPT_DUI_UNKNOWN = "This version of DialogueUI is not recognised."
L.REASON_DUI_CAPTIONS = "Turn on Mark Words in DialogueUI to use this."

L.OPT_REPORT_LINE_TIP = "Get a link to report a wrong reading or a mispronounced name."
L.OPT_REPORT_NO_LINE = "This client cannot tell which line that was, so there is no address to report."
L.OPT_STOP_GOSSIP = "Stop Gossip"
L.OPT_NEXT_GOSSIP = "Next Gossip"
--------------------------------------------------------------------------------
-- Azeroth's Compendium: the Quests tab (UI/QuestsTab.lua)
--------------------------------------------------------------------------------

L.COMPENDIUM_QUESTS = "Quests"
L.OPEN_IN_COMPENDIUM = "Open in Azeroth's Compendium"
L.OPEN_QUEST_IN_COMPENDIUM_TIP = "This quest's words in Azeroth's Compendium, beside every other quest's."
L.QUESTS_SEARCH = "Search quests"
L.QUESTS_NONE = "Nothing matches."
L.QUESTS_FOUND_ONLY = "Started Only"
L.QUESTS_VOICED_ONLY = "Voiced Only"
L.QUESTS_PICK = "Choose a quest on the left to read it. Shift-click one to queue its recording after what is playing."
L.QUESTS_ELSEWHERE = "Place Unknown"
L.QUESTS_SECTION_CLASSES = "Classes"
L.QUESTS_SECTION_PROFESSIONS = "Professions"
L.QUESTS_SECTION_EVENTS = "Holidays and Events"
L.QUESTS_SECTION_OTHER = "Other"
L.QUESTS_SECTION_BATTLEGROUNDS = "Battlegrounds"
L.QUESTS_SECTION_LANDS = "Other Lands"
L.QUESTS_DUNGEONS = "Dungeons and Raids"
L.QUESTS_GROUP_CHILDRENS_WEEK = "Children's Week"
L.QUESTS_GROUP_WINTER_VEIL = "Feast of Winter Veil"
L.QUESTS_GROUP_HALLOWS_END = "Hallow's End"
L.QUESTS_GROUP_LOVE_IS_IN_THE_AIR = "Love is in the Air"
L.QUESTS_GROUP_HARVEST_FESTIVAL = "Harvest Festival"
L.QUESTS_GROUP_SCOURGE_INVASION = "Scourge Invasion"
L.QUESTS_GROUP_COMMENDATIONS = "Commendation Signets"
L.QUESTS_GROUP_ARGENT_DAWN = "Argent Dawn"
L.QUESTS_GROUP_LIBRARY = "Library Books"
L.QUEST_NOT_FOUND = "You have not started this quest yet. Accept it in the world to read it here."
L.QUESTS_FOUND_FMT = "%1$d of %2$d completed"
L.QUESTS_FOUND_GOING_FMT = "%1$d of %2$d completed, %3$d in progress"
L.QUESTS_IN_FMT = "In %1$s"
L.QUESTS_MORE_FMT = " and %1$d more"
L.QUESTS_TITLE_NTH_FMT = "%1$s (%2$d)"
L.QUEST_IN_PROGRESS = "In progress"
L.QUEST_PART_ACCEPT = "Description"
L.QUEST_PART_COMPLETE = "Completion"
L.QUEST_PART_PLAY_TIP = "Hear this part of the quest read aloud."
L.QUEST_NO_TEXT = "No words are known for this quest."
L.QUEST_PART_NO_TEXT = "No words are known for this part."
L.QUEST_NO_WORDS_YET = "No words yet: this quest has not been recorded."
