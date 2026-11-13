local _, Developer = ...

-- French interface strings for Spoken Developer.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

if GetLocale() ~= "frFR" then return end

local L = Developer.L

-- The Developer page (UI/Options.lua).
L.OPT_DEVELOPER = "Développeur"
L.OPT_DEVELOPER_INTRO = "Outils pour tester Spoken et signaler des problèmes."
L.OPT_LOG_SECTION = "Journal de débogage"
L.OPT_LOG_KEEP = "Tenir un journal de débogage"
L.OPT_LOG_SIZE = "Taille du journal"
-- "1234 of 2000 lines, 96 KB", then "; other players' logs: 2" where there are any.
L.LOG_SIZE_FMT = "%1$d lignes sur %2$d, %3$s"
L.LOG_SIZE_OTHERS_FMT = " ; journaux d'autres joueurs : %1$d"
L.OPT_LOG_SHOW = "Afficher le journal"
L.OPT_LOG_COPY = "Copier avec le diagnostic"
L.OPT_LOG_WRITE = "Écrire pour un agent IA"
L.OPT_LOG_WRITE_TIP = "Recharge l'interface pour enregistrer le journal sur le disque."
L.OPT_LOG_CLEAR = "Vider le journal"
L.OPT_LOG_COMMANDS = "/spoken log : l'affiche\n/spoken log copy : le copie avec le diagnostic\n/spoken log write : l'écrit pour un agent IA\n/spoken log on, /spoken log off : l'active ou le désactive\n/spoken log clear : le vide\nÉcrit, ou après un /reload, il est dans :\nWTF\\Account\\<compte>\\SavedVariables\\Spoken_Developer.lua"
L.OPT_CHAT_SECTION = "Messages dans le chat"
L.OPT_TESTING_SECTION = "Tests"
-- Under the commands: how to ask an AI agent, a question and the steps to take.
L.OPT_LOG_AGENT_TITLE = "Comment faire lire les journaux à un agent IA ?"
L.OPT_LOG_AGENT_STEPS = "1. Gardez la quête ouverte.\n2. Faites un clic droit sur son bouton Contribuer ou Signaler un problème.\n3. Choisissez « Écrire le journal pour un agent IA ». L'interface se recharge, ce qui enregistre le journal.\n4. Demandez à l'agent IA de cet ordinateur (Claude Code, par exemple), par exemple :\n    « La voix ne s'est pas lancée pour la quête que je viens d'ouvrir. Lis le journal de débogage de Spoken et dis-moi pourquoi. »\n\nOu, pour un agent IA qui ne peut pas lire les fichiers de cet ordinateur (une conversation dans le navigateur) : à l'étape 3, choisissez plutôt « Copier le journal de débogage » (sur cette page, « Copier avec le diagnostic »), appuyez sur Ctrl+C, puis collez-le dans la fenêtre de l'agent avec votre question."
-- The welcome window's switch (Spoken's UI/Welcome.lua asks for these).
L.WELCOME_LOG_TIP = "Spoken note ce qu'il lit et pourquoi. Si quelque chose ne va pas, c'est le journal qu'il faut joindre au signalement, et il ne montre que ce qui s'est passé pendant qu'il était activé. Il se trouve dans Spoken > Développeur, où il peut être désactivé."
-- The box (UI/Box.lua, Copy.lua).
L.LOG_BOX_TITLE = "Journal de débogage de Spoken - Ctrl+A, puis Ctrl+C pour copier"
L.BOX_TITLE_COPY = "Journal de débogage de Spoken avec diagnostic - Ctrl+A, puis Ctrl+C pour copier"
-- A Report button's right-click (UI/Menu.lua).
L.MENU_COPY = "Copier le journal de débogage"
L.MENU_WRITE = "Écrire le journal pour un agent IA"
L.MENU_TURN_ON = L.OPT_LOG_KEEP
L.MENU_HINT = "Clic droit : copier le journal de débogage, ou l'écrire pour un agent IA"
L.MENU_HINT_OFF = "Clic droit : activer le journal de débogage pour les signalements"
