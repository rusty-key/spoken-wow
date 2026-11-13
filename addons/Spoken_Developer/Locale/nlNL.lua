local _, Developer = ...

-- Dutch interface strings for Spoken Developer.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.
-- No game client runs in Dutch, so this file loads where the player chose it in
-- Spoken's Interface Language, after the client's own file.

if not (Spoken and Spoken.InterfaceLanguage and Spoken:InterfaceLanguage() == "nlNL") then return end

local L = Developer.L

-- The Developer page (UI/Options.lua).
L.OPT_DEVELOPER = "Ontwikkelaar"
L.OPT_DEVELOPER_INTRO = "Hulpmiddelen om Spoken te testen en problemen te melden."
L.OPT_LOG_SECTION = "Debuglog"
L.OPT_LOG_KEEP = "Debuglog bijhouden"
L.OPT_LOG_SIZE = "Grootte van de log"
-- "1234 of 2000 lines, 96 KB", then "; other players' logs: 2" where there are any.
L.LOG_SIZE_FMT = "%1$d van %2$d regels, %3$s"
L.LOG_SIZE_OTHERS_FMT = "; logs van andere spelers: %1$d"
L.OPT_LOG_SHOW = "Log tonen"
L.OPT_LOG_COPY = "Kopiëren met diagnose"
L.OPT_LOG_WRITE = "Wegschrijven voor een AI-agent"
L.OPT_LOG_WRITE_TIP = "Herlaadt de interface om de log op schijf op te slaan."
L.OPT_LOG_CLEAR = "Log wissen"
L.OPT_LOG_COMMANDS = "/spoken log: toont hem\n/spoken log copy: kopieert hem, met de diagnose\n/spoken log write: schrijft hem weg voor een AI-agent\n/spoken log on, /spoken log off: zet hem aan of uit\n/spoken log clear: maakt hem leeg\nNa het wegschrijven, of na een /reload, staat hij in:\nWTF\\Account\\<account>\\SavedVariables\\Spoken_Developer.lua"
L.OPT_CHAT_SECTION = "Chatberichten"
L.OPT_TESTING_SECTION = "Testen"
-- Under the commands: how to ask an AI agent, a question and the steps to take.
L.OPT_LOG_AGENT_TITLE = "Hoe laat je een AI-agent de logs lezen?"
L.OPT_LOG_AGENT_STEPS = "1. Houd de quest open.\n2. Klik met rechts op de knop Bijdragen of Probleem melden ervan.\n3. Kies ‘Debuglog wegschrijven voor een AI-agent’. De interface herlaadt, en daarmee wordt de log opgeslagen.\n4. Vraag het de AI-agent op deze computer (bijvoorbeeld Claude Code), zoals:\n    \"De stem speelde niet af bij de quest die ik net opende. Lees de debuglog van Spoken en vertel me waarom.\"\n\nOf, voor een AI-agent die de bestanden op deze computer niet kan lezen (een chat in de browser): kies bij stap 3 in plaats daarvan ‘Debuglog kopiëren’ (op deze pagina: ‘Kopiëren met diagnose’), druk op Ctrl+C en plak hem met je vraag in het venster van de agent."
-- The welcome window's switch (Spoken's UI/Welcome.lua asks for these).
L.WELCOME_LOG_TIP = "Spoken houdt bij wat het afspeelt en waarom. Gaat er iets mis, dan stuur je de log mee met je melding; hij toont alleen wat er gebeurde terwijl hij aan stond. Je vindt hem onder Spoken > Ontwikkelaar, waar je hem ook weer uit kunt zetten."
-- The box (UI/Box.lua, Copy.lua).
L.LOG_BOX_TITLE = "Debuglog van Spoken - Ctrl+A en dan Ctrl+C om te kopiëren"
L.BOX_TITLE_COPY = "Debuglog van Spoken met diagnose - Ctrl+A en dan Ctrl+C om te kopiëren"
-- A Report button's right-click (UI/Menu.lua).
L.MENU_COPY = "Debuglog kopiëren"
L.MENU_WRITE = "Debuglog wegschrijven voor een AI-agent"
L.MENU_TURN_ON = L.OPT_LOG_KEEP
L.MENU_HINT = "Rechtsklik: de debuglog kopiëren, of wegschrijven voor een AI-agent"
L.MENU_HINT_OFF = "Rechtsklik: debuglog bijhouden, om mee te sturen met een melding"
