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
L.OPT_AUTOPLAY_TIP = "Quests, greetings and gossip. Off, nothing is read until you press Play on the window or type /spq read."
L.OPT_GREETING_FREQ = "NPC Greeting Playback Frequency"
L.OPT_GREETING_FREQ_TIP = "Controls how often Spoken Quests will play NPC greeting dialog. The Once options are remembered for this character across NPC revisits and logins."
L.OPT_GREETING_ALWAYS = "Always"
L.OPT_GREETING_ONCE_QUEST = "Once per Quest NPC (per character)"
L.OPT_GREETING_ONCE_NPC = "Once per NPC (per character)"
L.OPT_GREETING_NEVER = "Never"
L.OPT_SYNC_WINDOW = "Sync Dialog to Window State"
L.OPT_SYNC_WINDOW_TIP = "Narration will automatically stop when the gossip/quest window is closed."
L.OPT_SECTION_LANGUAGE = "Language"
L.OPT_VOICE_LANGUAGE = "Voice Language"
L.OPT_VOICE_LANGUAGE_TIP = "Which language the voices speak. Auto uses your game's language. A language is only heard if its voice pack is installed."
L.OPT_LANG_AUTO_FMT = "Auto (%1$s)"
L.OPT_FALLBACK_LANGUAGE = "If a Line Is Missing"
L.OPT_FALLBACK_LANGUAGE_TIP = "What to play when the voice pack in your language has no recording of a line: the same line in another language, or nothing."
L.OPT_FALLBACK_NONE = "Stay Silent"
L.OPT_FOLLOWUP = "Experimental: Enable Quest Follow-ups"
L.OPT_FOLLOWUP_TIP = "Some NPCs speak in chat after you accept or turn in a quest. Only lines your own quest set off are read, never another player's."
L.OPT_OG_THRALL = "Original Thrall Speech"
L.OPT_OG_THRALL_TIP = "Plays the original AI VoiceOver recording of Thrall's \"All members of the Horde are equal in my eyes\" speech instead of this addon's."
L.OPT_GROUP_DEBUG = "Debugging Tools"
L.OPT_DEBUG = "Enable Debug Messages"
L.OPT_DEBUG_TIP = "Enables printing of some \"useful\" debug messages to the chat window."

--------------------------------------------------------------------------------
-- Options window: sound-pack tab
--------------------------------------------------------------------------------

L.OPT_TAB_DATA_MODULES = "Data Modules"
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
L.OPT_PACK_LOADED = "Installed"
L.OPT_PACK_NOT_LOADED = "Not loaded"
L.OPT_CONTENT_VERSION_FMT = "%1$s"
L.OPT_CONTENT_VERSION_UPDATE_FMT = "%2$s -> |cFF00CCFF%1$s|r"

--------------------------------------------------------------------------------
-- Slash commands (also listed in the options window)
--------------------------------------------------------------------------------

L.OPT_CMD_GROUP = "Commands"
L.OPT_CMD_PLAYPAUSE = "Play/Pause Audio"
L.OPT_CMD_PLAYPAUSE_DESC = "Play/Pause voiceovers"
L.OPT_CMD_PLAY = "Play Audio"
L.OPT_CMD_PLAY_DESC = "Resume the playback of voiceovers"
L.OPT_CMD_PAUSE = "Pause Audio"
L.OPT_CMD_PAUSE_DESC = "Pause the playback of voiceovers"
L.OPT_CMD_SKIP = "Skip Line"
L.OPT_CMD_SKIP_DESC = "Skip the currently played voiceover"
L.OPT_CMD_CLEAR = "Clear Queue"
L.OPT_CMD_CLEAR_DESC = "Stop the playback and clears the voiceovers queue"
L.OPT_CMD_READ = "Read Visible Quest"
L.OPT_CMD_READ_DESC = "Narrate the quest panel that is currently visible"
L.OPT_CMD_TEST = "Test Audio"
L.OPT_CMD_TEST_DESC = "Play a short known file from the Vanilla Data module"
L.OPT_CMD_FOLLOWUP = "Follow-up"
L.OPT_CMD_FOLLOWUP_DESC = "Replay a quest's follow-up NPC lines as if you had just turned it in: /spq followup <questID> [start]"
L.OPT_CMD_DIAG = "Diagnostics"
L.OPT_CMD_DIAG_DESC = "Print client, API, and voice pack loading status"
L.OPT_CMD_OPTIONS = "Open Options"
L.OPT_CMD_OPTIONS_DESC = "Open the options panel"

--------------------------------------------------------------------------------
-- Interface-settings canvas
--------------------------------------------------------------------------------

L.OPT_PANEL_NOTE = "Voices for quest givers and the NPCs you talk to. Volume, language, the window and subtitles are on the Spoken page, since they cover every module."
L.OPT_SECTION_DIALOGUE = "When to Read"
L.OPT_PANEL_AUTOPLAY = "Read Automatically"
L.OPT_PANEL_AUTOPLAY_TIP = "Reads quests and conversations as soon as their window opens. Off, nothing starts by itself: press Play on the window, or type /spq read."
L.OPT_PANEL_GREETINGS = "NPC Greetings"
L.OPT_PANEL_GREETINGS_TIP = "How often to read what an NPC says when you start talking to them. \"Once\" is remembered for this character, even after you log out."
L.OPT_GREETING_LABEL_ALWAYS = "Every Time"
L.OPT_GREETING_LABEL_ONCE_QUEST = "Once per NPC with Quests"
L.OPT_GREETING_LABEL_ONCE_NPC = "Once per NPC"
L.OPT_GREETING_LABEL_NEVER = "Never"
L.OPT_PANEL_STOP_ON_CLOSE = "Stop When Window Closes"
L.OPT_PANEL_STOP_ON_CLOSE_TIP = "Stops the voice as soon as you close the quest or conversation window."
L.OPT_PANEL_FOLLOWUP = "Follow-up Lines"
L.OPT_PANEL_FOLLOWUP_TIP = L.OPT_FOLLOWUP_TIP
L.OPT_SECTION_PACKS = "Voice Packs"
L.OPT_SECTION_HISTORY = "Reading History"
L.OPT_FORGET_GREETINGS = "Forget Greetings Heard"
L.OPT_FORGET_GREETINGS_TIP = "Clears this character's list of NPCs whose greeting it has heard, so each greets you again. Only matters while NPC Greetings is set to read once."
L.OPT_FORGET_GREETINGS_DONE = "This character's list of greetings heard is cleared."
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
L.OPT_LISTEN = "Listen"
L.OPT_PLAY_TIP = "Hear this quest read aloud."
L.OPT_PAUSE = "Pause"
L.OPT_PAUSE_TIP = "The game cannot resume a sound part-way through, so playing again starts the line from the beginning."
L.OPT_STOP = "Stop"
L.OPT_STOP_TIP = "Stop reading"
L.OPT_READ_TIP = "Read this aloud"
L.OPT_GREETING = "Greeting"
L.OPT_AUTOPLAY_OFF_TIP = "Read Automatically is turned off on the Quests page of the Spoken settings."
L.OPT_CONTRIBUTE = "Contribute"
L.OPT_REPORT = "Report"
L.OPT_CONTRIBUTE_TIP_LINE = "Spoken Quests doesn't have this line"
L.OPT_CONTRIBUTE_TIP_QUEST = "Spoken Quests doesn't have this quest"
L.OPT_CONTRIBUTE_TIP_SHARE = "Contribute your data by sharing data from your client"
L.OPT_REPORT_COPY = "Spoken Quests|n|nCopy this address and open it in your browser to report this line."

--------------------------------------------------------------------------------
-- Minimap menu and player settings link
--------------------------------------------------------------------------------

L.OPT_MINIMAP_SETTINGS = "Quests Settings"

-- The page under Spoken in the game's settings.
L.OPT_PAGE_TITLE = "Quests"

L.OPT_PART_SWITCH = "Enable Module"
L.OPT_PART_SWITCH_TIP = "Turns quest and conversation voices on or off. Off, the module stays installed but reads nothing. The same switch is on the Spoken page."
L.REASON_PART_OFF = "Turn on Enable Module at the top of this page to use this."
L.REASON_AUTOPLAY = "Turn on Read Automatically to use this."
L.OPT_RESET_PROFILE_CONFIRM = "Reset every Quests setting in the profile in use to its default?"
L.OPT_RESET = "Reset"
L.OPT_CANCEL = "Cancel"


L.OPT_SECTION_EXTRAS = "Extras"

L.OPT_SECTION_START_OVER = "Start Over"
