if not SpokenGossipEnv then return end
setfenv(1, SpokenGossipEnv)

-- Interface strings for Spoken Gossip, and the key set every other language is measured
-- against. A locale file per language overlays this table (Locale/<code>.lua), so anything
-- missing falls back to English at runtime.
--
-- FORMAT ARGUMENTS ARE POSITIONAL (%1$s, %2$d), even where there is only one and the position is
-- obvious. Word order is the thing a translator most often has to change and least often can.
--
-- The windows' Listen and Contribute buttons and the Report action are the dialogue core's, in
-- Spoken's strings (DIALOGUE_*).

L = {}

L.OPT_PAGE_TITLE = "Gossip"
L.OPT_PANEL_NOTE = "Voices for what NPCs say when you talk to them. Volume, language, the window and subtitles are on the Spoken page, since they cover every module."
L.OPT_PART_SWITCH = "Enable Module"
L.OPT_PART_SWITCH_TIP = "Turns NPC conversation voices on or off. Off, the module stays installed but reads nothing. The same switch is on the Spoken page."
L.REASON_PART_OFF = "Turn on Enable Module at the top of this page to use this."
L.OPT_SECTION_DIALOGUE = "When to Read"
L.OPT_PANEL_GREETINGS = "NPC Greetings"
L.OPT_PANEL_GREETINGS_TIP = "How often to read what an NPC says when you start talking to them. \"Once\" is remembered for this character, even after you log out. At Never, nothing starts by itself: press Listen on the window."
L.OPT_GREETING_LABEL_ALWAYS = "Every Time"
L.OPT_GREETING_LABEL_ONCE_QUEST = "Once per NPC with Quests"
L.OPT_GREETING_LABEL_ONCE_NPC = "Once per NPC"
L.OPT_GREETING_LABEL_NEVER = "Never"
L.OPT_PANEL_STOP_ON_CLOSE = "Stop When Window Closes"
L.OPT_PANEL_STOP_ON_CLOSE_TIP = "Stops the voice as soon as you close the greeting or gossip window."
L.OPT_SECTION_EXTRAS = "Extras"
L.OPT_OG_THRALL = "Original Thrall Speech"
L.OPT_OG_THRALL_TIP = "Plays the original AI VoiceOver recording of Thrall's \"All members of the Horde are equal in my eyes\" speech instead of this addon's."
L.OPT_SECTION_HISTORY = "Reading History"
L.OPT_FORGET_GREETINGS = "Forget Greetings Heard"
L.OPT_FORGET_GREETINGS_TIP = "Clears this character's list of NPCs whose greeting it has heard, so each greets you again. Only matters while NPC Greetings is set to read once."
L.OPT_FORGET_GREETINGS_DONE = "This character's list of greetings heard is cleared."
L.OPT_SECTION_PACKS = "Voice Packs"
L.OPT_NO_PACK = "|cffff8080No voice pack installed.|r Nothing is read aloud without one."
L.OPT_PACK_NAME_FMT = "Voice Pack (%1$s)"
L.OPT_PACK_GOSSIP = "Gossip"
L.OPT_PACK_ALL = "All Quests"
L.OPT_PACK_NOT_LOADED = "Not loaded"
L.OPT_PACK_LOADED = "Installed"
L.OPT_PACK_INCLUDED = "In All Quests"
L.OPT_DOWNLOAD = "Download"
L.OPT_COPY_ADDRESS_FMT = "Shows the address to copy into your web browser: %1$s"
L.OPT_SECTION_START_OVER = "Start Over"
L.OPT_RESET_PROFILE = "Reset Gossip Settings"
L.OPT_RESET_PROFILE_TIP = "Puts every setting on this page back to its default, in the profile in use."
L.OPT_RESET_PROFILE_CONFIRM = "Reset every Gossip setting in the profile in use to its default?"
L.OPT_RESET = "Reset"
L.OPT_CANCEL = "Cancel"
L.OPT_MINIMAP_SETTINGS = "Gossip Settings"
L.OPT_GREETING = "Greeting"
L.OPT_STOP_GOSSIP = "Stop Gossip"
L.OPT_NEXT_GOSSIP = "Next Gossip"
L.OPT_NEVER_TIP = "NPC Greetings is set to Never on the Gossip page of the Spoken settings."
L.OPT_GROUP_GENERAL = "General"
L.OPT_CMD_GROUP = "Commands"
L.OPT_CMD_READ = "Read Open Window"
L.OPT_CMD_READ_DESC = "Reads the greeting or gossip window that is open"
L.OPT_CMD_OPTIONS = "Open Options"
L.OPT_CMD_OPTIONS_DESC = "Opens or closes the options window"
L.OPT_SECTION_TROUBLE = "Fix a Problem"
L.OPT_TEST_LINE = "Play a Test Line"
L.OPT_TEST_LINE_TIP = "Plays a line Spoken Gossip knows it has, the same way a real one plays, to check that you can hear it."
L.OPT_PRINT_DIAG = "Show Diagnostics"
L.OPT_PRINT_DIAG_TIP = "Lists your game version, the NPC Greetings setting and the voice packs that hold gossip in chat, for a bug report."
L.OPT_REPORT_PROBLEM = "Report a Problem"
L.OPT_REPORT_PROBLEM_TIP = "For anything that isn't about one line; each line has its own Report button. Gives you an address to copy into your web browser."
L.OPT_CMD_TEST = "Test Audio"
L.OPT_CMD_TEST_DESC = "Plays a known NPC line to check that you can hear it"
L.OPT_CMD_DIAG = "Diagnostics"
L.OPT_CMD_DIAG_DESC = "Prints client, API and voice pack status"
