local _, Developer = ...

-- Interface strings for Spoken Developer, and the key set every other language is measured
-- against. A locale file per language overlays this table, so anything missing falls back to
-- English. Chat prints stay English everywhere, as in the other Spoken addons: they are read
-- by whoever fixes the problem.

Developer.L = Developer.L or {}
local L = Developer.L

L.TITLE = "Spoken Developer"
-- The Developer page (UI/Options.lua).
L.OPT_DEVELOPER = "Developer"
L.OPT_DEVELOPER_INTRO = "Tools for testing Spoken and reporting problems."
L.OPT_LOG_SECTION = "Debug Log"
L.OPT_LOG_KEEP = "Keep a Debug Log"
L.OPT_LOG_SIZE = "Log Size"
-- "1234 of 2000 lines, 96 KB", then "; other players' logs: 2" where there are any.
L.LOG_SIZE_FMT = "%1$d of %2$d lines, %3$s"
L.LOG_SIZE_OTHERS_FMT = "; other players' logs: %1$d"
L.OPT_LOG_SHOW = "Show the Log"
L.OPT_LOG_COPY = "Copy with Diagnostics"
L.OPT_LOG_WRITE = "Write for an AI Agent"
L.OPT_LOG_WRITE_TIP = "Reloads the interface to save the log to disk."
L.OPT_LOG_CLEAR = "Clear the Log"
L.OPT_LOG_COMMANDS = "/spoken log: shows it\n/spoken log copy: copies it, with the diagnostics\n/spoken log write: writes it for an AI agent\n/spoken log on, /spoken log off: turns it on or off\n/spoken log clear: empties it\nWritten, or after a /reload, it is in:\nWTF\\Account\\<account>\\SavedVariables\\Spoken_Developer.lua"
L.OPT_CHAT_SECTION = "Chat Messages"
L.OPT_TESTING_SECTION = "Testing"
-- Under the commands: how to ask an AI agent, a question and the steps to take.
L.OPT_LOG_AGENT_TITLE = "How to use an AI agent to read the logs?"
L.OPT_LOG_AGENT_STEPS = "1. Keep the quest open.\n2. Right-click its Contribute or Report a Problem button.\n3. Choose Write the Debug Log for an AI Agent. The interface reloads, which saves the log.\n4. Ask the AI agent on this computer (Claude Code, for one), for example:\n    \"The voice-over did not play for the quest I just opened. Read the Spoken debug log and tell me why.\"\n\nOr, for an AI agent that cannot read this computer's files (a chat in the browser): at step 3, choose Copy the Debug Log instead (Copy with Diagnostics on this page), press Ctrl+C, and paste it into the agent's window with your question."
-- The welcome window's switch (Spoken's UI/Welcome.lua asks for these).
L.WELCOME_LOG_TIP = "Spoken notes what it plays and why. If something goes wrong, the log is what to send with a report, and it only shows what happened while it was on. It is in Spoken > Developer, where it can be turned off again."
-- The box (UI/Box.lua, Copy.lua).
L.LOG_BOX_TITLE = "Spoken debug log - Ctrl+A, then Ctrl+C to copy"
L.BOX_TITLE_COPY = "Spoken debug log with diagnostics - Ctrl+A, then Ctrl+C to copy"
-- A Report button's right-click (UI/Menu.lua).
L.MENU_COPY = "Copy the Debug Log"
L.MENU_WRITE = "Write the Debug Log for an AI Agent"
L.MENU_TURN_ON = L.OPT_LOG_KEEP
L.MENU_HINT = "Right-click: copy the debug log, or write it for an AI agent"
L.MENU_HINT_OFF = "Right-click: enable debug log recording, to send with a report"
