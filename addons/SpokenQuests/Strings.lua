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
L.OPT_VOICE_LANGUAGE = "Voice language"
L.OPT_VOICE_LANGUAGE_TIP = "Which language's sound pack to speak in. Auto uses the language your game runs in. A language is only heard if a sound pack recorded in it is installed."
L.OPT_LANG_AUTO_FMT = "Auto (%1$s)"
L.OPT_FALLBACK_LANGUAGE = "Fallback language"
L.OPT_FALLBACK_LANGUAGE_TIP = "What to play when no pack in your chosen language holds a line. None leaves that line silent rather than speaking it in a language you did not ask for."
L.OPT_FALLBACK_NONE = "None (stay silent)"
L.OPT_OG_THRALL = "OG Thrall"
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
L.OPT_CMD_DIAG = "Diagnostics"
L.OPT_CMD_DIAG_DESC = "Print client, API, and sound-pack loading status"
L.OPT_CMD_OPTIONS = "Open Options"
L.OPT_CMD_OPTIONS_DESC = "Open the options panel"

--------------------------------------------------------------------------------
-- Interface-settings canvas
--------------------------------------------------------------------------------

L.OPT_PANEL_NOTE = "Quest and gossip dialogue read aloud. The sound channel and the player window are Spoken Player's settings, since they cover every Spoken addon."
L.OPT_SECTION_DIALOGUE = "Dialogue"
L.OPT_PANEL_AUTOPLAY = "Read dialogue when it opens"
L.OPT_PANEL_AUTOPLAY_TIP = "Quests, NPC greetings and gossip. Off, nothing starts by itself: press Play on the window, or type /spq read."
L.OPT_PANEL_GREETINGS = "NPC greetings"
L.OPT_PANEL_GREETINGS_TIP = "How often an NPC's greeting is read. The Once options are remembered for this character across revisits and logins."
L.OPT_GREETING_LABEL_ALWAYS = "Always"
L.OPT_GREETING_LABEL_ONCE_QUEST = "Once per quest NPC"
L.OPT_GREETING_LABEL_ONCE_NPC = "Once per NPC"
L.OPT_GREETING_LABEL_NEVER = "Never"
L.OPT_PANEL_STOP_ON_CLOSE = "Stop when the quest window closes"
L.OPT_PANEL_STOP_ON_CLOSE_TIP = "Narration stops as soon as you close the gossip or quest window."
L.OPT_SECTION_PACKS = "Sound packs"
L.OPT_NO_PACK = "|cffff8080No sound pack installed.|r Nothing is read aloud without one."
L.OPT_NOT_INSTALLED = "Not installed:"
L.OPT_COPY_ADDRESS_FMT = "Hands you the address to copy: %1$s"
L.OPT_SECTION_TROUBLE = "Troubleshooting"
L.OPT_PANEL_DEBUG = "Print debug messages"
L.OPT_PANEL_DEBUG_TIP = "Prints what the addon decided, and why, to the chat window."
L.OPT_TEST_LINE = "Play a test line"
L.OPT_TEST_LINE_TIP = "Plays a known line through the player, the way a real one goes."
L.OPT_PRINT_DIAG = "Print diagnostics"
L.OPT_PRINT_DIAG_TIP = "Prints the client, the sound settings and what the addon has loaded."
L.OPT_SECTION_PROFILE = "Profile"
L.OPT_PROFILE = "Settings profile"
L.OPT_PROFILE_TIP = "Profiles keep a separate set of these settings. Characters can share one or have their own."
L.OPT_RESET_PROFILE = "Reset this profile"
L.OPT_RESET_PROFILE_TIP = "Puts every setting in this profile back to its default."
L.OPT_COPY_PROFILE = "Copy settings from"
L.OPT_COPY_PROFILE_TIP = "Overwrites this profile with another's."
L.OPT_COPY_PICK = "pick one"
L.OPT_DELETE_PROFILE = "Delete a profile"
L.OPT_DELETE_PROFILE_TIP = "Deletes a profile you are not using."
L.OPT_PACK_ALL = "All"
L.OPT_PACK_ALLIANCE = "Alliance"
L.OPT_PACK_HORDE = "Horde"
L.OPT_PACK_SHARED = "Shared Quests"
L.OPT_PACK_GOSSIP = "Gossip"

--------------------------------------------------------------------------------
-- Quest and gossip windows
--------------------------------------------------------------------------------

L.OPT_PLAY = "Play"
L.OPT_STOP = "Stop"
L.OPT_STOP_TIP = "Stop reading"
L.OPT_READ_TIP = "Read this aloud"
L.OPT_AUTOPLAY_OFF_TIP = "Autoplay is off in the Spoken Quests settings."
L.OPT_CONTRIBUTE = "Contribute"
L.OPT_REPORT = "Report"
L.OPT_CONTRIBUTE_TIP_LINE = "Spoken Quests doesn't have this line"
L.OPT_CONTRIBUTE_TIP_QUEST = "Spoken Quests doesn't have this quest"
L.OPT_CONTRIBUTE_TIP_SHARE = "Contribute your data by sharing data from your client"
L.OPT_REPORT_COPY = "Spoken Quests|n|nCopy this address and open it in your browser to report this line."

--------------------------------------------------------------------------------
-- Minimap menu and player settings link
--------------------------------------------------------------------------------

L.OPT_MINIMAP_READ = "Read visible quest"
L.OPT_MINIMAP_SETTINGS = "Spoken Quests settings"
