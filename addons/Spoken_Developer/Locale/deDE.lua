local _, Developer = ...

-- German interface strings for Spoken Developer.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

if GetLocale() ~= "deDE" then return end

local L = Developer.L

-- The Developer page (UI/Options.lua).
L.OPT_DEVELOPER = "Entwickler"
L.OPT_DEVELOPER_INTRO = "Werkzeuge, um Spoken zu testen und Probleme zu melden."
L.OPT_LOG_SECTION = "Debug-Protokoll"
L.OPT_LOG_KEEP = "Debug-Protokoll führen"
L.OPT_LOG_SIZE = "Protokollgröße"
-- "1234 of 2000 lines, 96 KB", then "; other players' logs: 2" where there are any.
L.LOG_SIZE_FMT = "%1$d von %2$d Zeilen, %3$s"
L.LOG_SIZE_OTHERS_FMT = "; Protokolle anderer Spieler: %1$d"
L.OPT_LOG_SHOW = "Protokoll zeigen"
L.OPT_LOG_COPY = "Mit Diagnose kopieren"
L.OPT_LOG_WRITE = "Für einen KI-Agenten schreiben"
L.OPT_LOG_WRITE_TIP = "Lädt die Oberfläche neu, um das Protokoll auf die Festplatte zu schreiben."
L.OPT_LOG_CLEAR = "Protokoll leeren"
L.OPT_LOG_COMMANDS = "/spoken log: zeigt es\n/spoken log copy: kopiert es mit der Diagnose\n/spoken log write: schreibt es für einen KI-Agenten\n/spoken log on, /spoken log off: schaltet es ein oder aus\n/spoken log clear: leert es\nGeschrieben oder nach einem /reload steht es in:\nWTF\\Account\\<Konto>\\SavedVariables\\Spoken_Developer.lua"
L.OPT_CHAT_SECTION = "Chatmeldungen"
L.OPT_TESTING_SECTION = "Testen"
-- Under the commands: how to ask an AI agent, a question and the steps to take.
L.OPT_LOG_AGENT_TITLE = "Wie lässt man einen KI-Agenten die Protokolle lesen?"
L.OPT_LOG_AGENT_STEPS = "1. Die Quest offen lassen.\n2. Rechtsklick auf ihre Schaltfläche „Mitwirken“ oder „Problem melden“.\n3. „Debug-Protokoll für einen KI-Agenten schreiben“ wählen. Die Oberfläche lädt neu und speichert dabei das Protokoll.\n4. Den KI-Agenten auf diesem Computer (etwa Claude Code) fragen, zum Beispiel:\n    „Die Vertonung der Quest, die ich gerade geöffnet habe, wurde nicht abgespielt. Lies das Spoken-Debug-Protokoll und sag mir, warum.“\n\nOder, für einen KI-Agenten, der die Dateien dieses Computers nicht lesen kann (ein Chat im Browser): bei Schritt 3 stattdessen „Debug-Protokoll kopieren“ wählen (auf dieser Seite „Mit Diagnose kopieren“), Strg+C drücken und es mit deiner Frage in das Fenster des Agenten einfügen."
-- The welcome window's switch (Spoken's UI/Welcome.lua asks for these).
L.WELCOME_LOG_TIP = "Spoken notiert, was es abspielt und warum. Geht etwas schief, gehört das Protokoll zur Meldung, und es zeigt nur, was geschah, während es an war. Es liegt unter Spoken > Entwickler, wo es sich wieder ausschalten lässt."
-- The box (UI/Box.lua, Copy.lua).
L.LOG_BOX_TITLE = "Spoken-Debug-Protokoll - Strg+A, dann Strg+C zum Kopieren"
L.BOX_TITLE_COPY = "Spoken-Debug-Protokoll mit Diagnose - Strg+A, dann Strg+C zum Kopieren"
-- A Report button's right-click (UI/Menu.lua).
L.MENU_COPY = "Debug-Protokoll kopieren"
L.MENU_WRITE = "Debug-Protokoll für einen KI-Agenten schreiben"
L.MENU_TURN_ON = L.OPT_LOG_KEEP
L.MENU_HINT = "Rechtsklick: Debug-Protokoll kopieren oder für einen KI-Agenten schreiben"
L.MENU_HINT_OFF = "Rechtsklick: Debug-Protokoll für Meldungen aufzeichnen"
