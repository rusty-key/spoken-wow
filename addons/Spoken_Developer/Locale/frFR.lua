local _, Developer = ...

-- French interface strings for Spoken Developer.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

if GetLocale() ~= "frFR" then return end

local L = Developer.L

-- The Developer page (UI/Options.lua).
L.OPT_DEVELOPER = "Développeur"
L.OPT_DEVELOPER_INTRO = "Outils de développement pour Spoken : le journal de débogage, les modes de débogage et ce que les modules de Spoken ajoutent pour les tests."
L.OPT_LOG_SECTION = "Journal de débogage"
L.OPT_LOG_KEEP = "Activer le journal de débogage"
L.OPT_LOG_KEEP_TIP = "Note ce que Spoken lit et pourquoi : chaque réplique mise en file, lancée, arrêtée ou écartée, avec l'heure, le diagnostic et ce qu'ajoutent les modules de Spoken. Gardé d'une session à l'autre, jusqu'à 2000 lignes, pour le joindre à un signalement. Rien n'est gardé tant qu'il est désactivé."
L.OPT_LOG_SIZE = "Taille"
L.OPT_LOG_SIZE_TIP = "Combien des 2000 lignes qu'il garde sont utilisées, et la place qu'elles prennent dans Spoken_Developer.lua."
-- "1234 of 2000 lines, 96 KB", then "; other players' logs: 2" where there are any.
L.LOG_SIZE_FMT = "%d lignes sur %d, %s"
L.LOG_SIZE_OTHERS_FMT = " ; journaux d'autres joueurs : %d"
L.OPT_LOG_SHOW = "Afficher le journal"
L.OPT_LOG_SHOW_TIP = "Le journal, et ceux réunis par d'autres addons Spoken, sur une seule chronologie dans une boîte : Ctrl+A, puis Ctrl+C pour le copier."
L.OPT_LOG_COPY = "Copier avec le diagnostic"
L.OPT_LOG_COPY_TIP = "Le diagnostic, puis tout le journal, dans une boîte : Ctrl+A, puis Ctrl+C pour le copier. Un clic droit sur un bouton Signaler fait de même."
L.OPT_LOG_WRITE = "Écrire pour un agent IA"
L.OPT_LOG_WRITE_TIP = "Enregistre le journal sur le disque maintenant, avec l'état du moment (la fenêtre, la quête, la file), en rechargeant l'interface : le jeu n'écrit les fichiers d'un addon qu'à ce moment-là. Un agent IA sur cet ordinateur peut alors le lire : dites-lui ce qui n'a pas marché."
L.OPT_LOG_CLEAR = "Vider le journal"
L.OPT_LOG_CLEAR_TIP = "Vide le journal, pour que la suite se lise comme une session de test à part."
L.OPT_LOG_COMMANDS = "/spoken log : l'affiche\n/spoken log copy : le copie avec le diagnostic\n/spoken log write : l'écrit pour un agent IA\n/spoken log on, /spoken log off : l'active ou le désactive\n/spoken log clear : le vide\nÉcrit, ou après un /reload, il est dans :\nWTF\\Account\\<compte>\\SavedVariables\\Spoken_Developer.lua"
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
