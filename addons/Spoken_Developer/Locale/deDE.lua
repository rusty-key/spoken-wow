local _, Developer = ...

-- German interface strings for Spoken Developer.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

if GetLocale() ~= "deDE" then return end

local L = Developer.L

-- The Developer page (UI/Options.lua).
L.OPT_DEVELOPER = "Entwickler"
L.OPT_DEVELOPER_INTRO = "Entwicklerwerkzeuge für Spoken: das Debug-Protokoll, Debug-Modi und was die Module von Spoken zum Testen hinzufügen."
L.OPT_LOG_SECTION = "Debug-Protokoll"
L.OPT_LOG_KEEP = "Debug-Protokoll aufzeichnen"
L.OPT_LOG_KEEP_TIP = "Notiert, was Spoken abspielt und warum: jede Zeile, die eingereiht, gestartet, gestoppt oder verworfen wird, mit der Uhrzeit, die Diagnose und was die Module von Spoken hinzufügen. Bleibt über Sitzungen erhalten, bis zu 2000 Zeilen, um es einer Meldung beizulegen. Solange es aus ist, wird nichts gespeichert."
L.OPT_LOG_SIZE = "Größe"
L.OPT_LOG_SIZE_TIP = "Wie viele der 2000 Zeilen, die es behält, belegt sind, und wie viel Platz sie in Spoken_Developer.lua einnehmen."
-- "1234 of 2000 lines, 96 KB", then "; other players' logs: 2" where there are any.
L.LOG_SIZE_FMT = "%d von %d Zeilen, %s"
L.LOG_SIZE_OTHERS_FMT = "; Protokolle anderer Spieler: %d"
L.OPT_LOG_SHOW = "Protokoll zeigen"
L.OPT_LOG_SHOW_TIP = "Das Protokoll und die von anderen Spoken-Addons gesammelten auf einer Zeitleiste in einem Feld: Strg+A, dann Strg+C zum Kopieren."
L.OPT_LOG_COPY = "Mit Diagnose kopieren"
L.OPT_LOG_COPY_TIP = "Die Diagnose, dann das ganze Protokoll, in einem Feld: Strg+A, dann Strg+C zum Kopieren. Ein Rechtsklick auf einen Melden-Knopf tut dasselbe."
L.OPT_LOG_WRITE = "Für einen KI-Agenten schreiben"
L.OPT_LOG_WRITE_TIP = "Speichert das Protokoll jetzt auf die Festplatte, mit dem aktuellen Stand (Fenster, Quest, Warteschlange), indem die Oberfläche neu geladen wird: Nur dann schreibt das Spiel die Dateien eines Addons. Ein KI-Agent auf diesem Computer kann es dann lesen: Sag ihm, was schiefging."
L.OPT_LOG_CLEAR = "Protokoll leeren"
L.OPT_LOG_CLEAR_TIP = "Leert das Protokoll, damit das Folgende als eigene Testsitzung zu lesen ist."
L.OPT_LOG_COMMANDS = "/spoken log: zeigt es\n/spoken log copy: kopiert es mit der Diagnose\n/spoken log write: schreibt es für einen KI-Agenten\n/spoken log on, /spoken log off: schaltet es ein oder aus\n/spoken log clear: leert es\nGeschrieben oder nach einem /reload steht es in:\nWTF\\Account\\<Konto>\\SavedVariables\\Spoken_Developer.lua"
-- Under the commands: how to ask an AI agent, a question and the steps to take.
L.OPT_LOG_AGENT_TITLE = "Wie lässt man einen KI-Agenten die Protokolle lesen?"
L.OPT_LOG_AGENT_STEPS = "1. Die Quest offen lassen.\n2. Rechtsklick auf ihren Knopf \"Mitwirken\" oder \"Problem melden\".\n3. \"Debug-Protokoll für einen KI-Agenten schreiben\" wählen. Die Oberfläche lädt neu und speichert dabei das Protokoll.\n4. Den KI-Agenten auf diesem Computer (etwa Claude Code) fragen, zum Beispiel:\n    \"Die Sprachausgabe der Quest, die ich gerade geöffnet habe, wurde nicht abgespielt. Lies das Spoken-Debug-Protokoll und sag mir, warum.\"\n\nOder, für einen KI-Agenten, der die Dateien dieses Computers nicht lesen kann (ein Chat im Browser): bei Schritt 3 stattdessen \"Debug-Protokoll kopieren\" wählen (auf dieser Seite \"Mit Diagnose kopieren\"), Strg+C drücken und es mit deiner Frage in das Fenster des Agenten einfügen."
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
