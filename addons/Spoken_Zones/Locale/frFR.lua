-- frFR. French interface strings for Spoken Zones.
--
-- Every key in Locale/enUS.lua belongs here, with the same positional format
-- arguments (%1$s) in whatever order this language needs them. Anything missing
-- falls back to English at runtime, and the shortfall is what keeps this language
-- out of the switcher -- see tools/locale/build-languages.mjs.

local _, SpokenZones = ...

if GetLocale() ~= "frFR" then
	return
end

local L = {}

L.OPT_NOTE = "Les récits des zones et sous-zones que vous visitez, lus à voix haute et affichés sur la carte du monde."
L.OPT_SECTION_MAP = "Carte du monde"
L.OPT_MAP_PANEL = "Récit à côté de la carte"
L.OPT_MAP_PANEL_TIP = "Affiche le panneau Récit du lieu, avec le récit de la zone ou sous-zone que vous regardez, à côté de la carte du monde. Masqué quand la carte occupe tout l'écran."
L.OPT_PICTURES = "Afficher les images"
L.OPT_PICTURES_TIP = "Affiche une image du lieu au-dessus de son récit."
L.OPT_PANEL_WIDTH = "Largeur du récit du lieu"
L.OPT_FONT_SIZE = "Taille du texte"
L.OPT_SECTION_NARRATION = "Quand lire"
L.OPT_PLAY_BUTTON = "Lire les récits à voix haute"
L.OPT_PLAY_BUTTON_TIP = "Lit les récits à voix haute : quand vous découvrez un lieu, et avec le bouton Lecture à côté de chaque récit dans le panneau Récit du lieu et le Compendium d'Azeroth. Désactivé, les récits restent affichés, en texte seulement."
L.OPT_AUTOPLAY = "Lire à la découverte"
L.OPT_AUTOPLAY_TIP = "Lit le récit d'un lieu au moment où le jeu annonce sa découverte, comme « Découverte : Durotar ». Le jeu le fait une fois par lieu pour chaque personnage."
L.OPT_AUTOPLAY_SUB = "Inclure les sous-zones"
L.OPT_AUTOPLAY_SUB_TIP = "Lit aussi les sous-zones d'une zone à mesure que vous les trouvez. Une traversée de la forêt d'Elwynn en fait découvrir plusieurs ; elles sont lues l'une après l'autre sans se couper."
L.OPT_AUTOPLAY_EXPLORED = "Inclure les lieux déjà découverts"
L.OPT_AUTOPLAY_EXPLORED_TIP = "Le jeu n'annonce une découverte qu'une fois, donc un personnage qui a déjà exploré n'entendrait rien. Avec cette option, Spoken Zones tient sa propre liste à la place : un récit par lieu pour chaque personnage. Oublier les lieux lus, ci-dessous, l'efface."
L.OPT_SOUND_PACK = "Lire avec"
L.OPT_SOUND_PACK_TIP = "Le pack de voix installé qui lit les récits."
L.OPT_SECTION_LANGUAGE = "Langue"
L.OPT_LANG_RELOAD = "Tapez /reload pour passer à cette langue."
L.OPT_LANG_COUNT_FMT = "%1$d langues disponibles. Un changement s'applique après /reload."
L.OPT_LANGUAGE = "Langue des récits"
L.OPT_LANGUAGE_TIP = "Auto suit la langue de votre jeu, ou l'anglais s'il n'y a pas encore de traduction. Une langue choisie ici reste, quelle que soit la langue du jeu."
L.OPT_LANG_AUTO_FMT = "Auto (%1$s)"
L.OPT_LANG_SET_FMT = "Les récits seront en %1$s après le rechargement de l'interface."
L.OPT_SECTION_TROUBLE = "Résoudre un problème"
L.OPT_REPORT_PROBLEM = "Signaler un problème"
L.OPT_REPORT_ADDRESS = "Copiez cette adresse et ouvrez-la dans votre navigateur pour envoyer un retour sur Spoken Zones."
L.OPT_REPORT_NOTE = "Pour tout ce qui ne concerne pas un seul récit ; chaque récit a son propre bouton Signaler. Vous donne une adresse à copier dans votre navigateur."
L.MENU_LORE_WINDOW = "Ouvrir le Compendium d'Azeroth"
L.MENU_ZONE_SETTINGS = "Paramètres des Lieux"

L.OPT_REPORT_LINE_TIP = "Récit erroné, mauvaise lecture, nom mal prononcé : ceci donne un lien pour le signaler."
L.OPT_REPORT_LINE_ADDRESS = "Copiez cette adresse et ouvrez-la dans votre navigateur pour signaler un problème avec cette entrée."

L.AUDIO_READ_TIP = "Écouter la lecture de ce récit"
L.REPORT_BUTTON = "Signaler"
L.CONTRIBUTE_BUTTON = "Contribuer"
L.CONTRIBUTE_BUTTON_TIP_TITLE = "Spoken Zones n'a pas de récit pour cet endroit"
L.CONTRIBUTE_BUTTON_TIP = "Contribuez en le décrivant : ce que c'est, qui y vit, ce qui s'y est passé."
L.IN_ZONE_FMT = "Emplacement : %1$s"
L.LORE_WINDOW_EMPTY = "Choisissez un lieu à gauche pour lire son récit. Le nombre à côté d'une zone indique combien elle a de sous-zones ; cliquez dessus pour les voir."

L.PLAY = "Lecture"
L.STOP = "Arrêter"
L.STOP_TOOLTIP = "Arrête le récit. Rejouer le relit depuis le début."
L.REPLAY = "Rejouer"
L.REPLAY_TOOLTIP = "Relit le récit depuis le début."
L.QUEUE_HELD_COMBAT = "En attente de la fin du combat."
L.QUEUE_HELD_CINEMATIC = "En attente de la fin de la cinématique."
L.QUEUE_HELD_OFF = "La narration est désactivée."
L.NO_LORE_FOR = "Aucun récit enregistré pour %1$s pour l'instant."
L.LORE_NOT_WRITTEN = "%1$s est sur la carte, mais personne n'a encore écrit son récit."
L.NOT_DISCOVERED = "Vous n'avez pas encore découvert ce lieu."
L.MAP_LORE_FOR_FMT = "récit de %1$s"
L.OPT_PACK_NONE_INSTALLED = "rien d'installé"
L.CMD_HEADING = "commandes (/spokenzones, ou /spz) :"
L.CMD_STATUS = "  /spz            -- état de la zone et de la sous-zone actuelles"
L.CMD_OPTIONS = "  /spz options    -- ouvre le panneau des paramètres"
L.CMD_WINDOW = "  /spz window     -- ouvre le Compendium d'Azeroth"
L.CMD_PANEL = "  /spz panel      -- affiche ou masque le panneau Récit à côté de la carte"
L.CMD_PLAY = "  /spz play       -- lit le récit actuel"
L.CMD_STOP = "  /spz stop       -- arrête la narration"
L.CMD_VOICE = "  /spz voice      -- active ou désactive la narration"
L.CMD_AUTOPLAY = "  /spz autoplay   -- bascule la narration des zones découvertes"
L.CMD_AUDIO = "  /spz audio      -- liste les packs de voix, ou change avec /spz audio <name>"
L.CMD_LANG = "  /spz lang       -- liste les langues, ou change avec /spz lang <code> ou auto"
L.CMD_DISCOVER = "  /spz discover   -- simule la découverte d'une zone (dev)"
L.CMD_FORGET = "  /spz forget     -- oublie ce qui a été narré à ce personnage"
L.CMD_MINIMAP = "  /spz minimap    -- affiche ou masque le bouton de la minicarte"
L.CMD_DEBUG = "  /spz debug      -- signale les noms de zone au clic"
L.CMD_VERIFY = "  /spz verify     -- vérifie les données contre ce client"
L.CMD_DUMP = "  /spz dump       -- énumère l'arbre des cartes (dev)"

L.SUBZONE_COUNT_FMT = "%1$d sous-zones"

-- Settings page
L.OPT_PAGE_TITLE = "Lieux"
L.OPT_PART_SWITCH = "Activer le module"
L.OPT_PART_SWITCH_TIP = "Active ou désactive la lecture des récits des zones et sous-zones. Désactivé, le module reste installé mais ne lit rien. Le même interrupteur se trouve sur la page Spoken."
L.REASON_PART_OFF = "Activez l'option Activer le module en haut de cette page pour utiliser ceci."
L.REASON_VOICE = "Activez l'option Lire les récits à voix haute pour utiliser ceci."
L.REASON_DISCOVERY = "Activez l'option Lire à la découverte pour utiliser ceci."
L.REASON_MAP_PANEL = "Activez l'option Récit à côté de la carte pour utiliser ceci."
L.OPT_PANEL_WIDTH_TIP = "Règle la largeur du panneau Récit du lieu, à côté de la carte."
L.OPT_FONT_SIZE_TIP = "Règle la taille du texte des récits, dans le panneau Récit du lieu et le Compendium d'Azeroth."

-- Voice packs
L.OPT_SECTION_PACKS = "Packs de voix"
L.OPT_PACK_NAME_FMT = "Pack de voix (%1$s)"
L.OPT_PACK_OFFICIAL = "Lieux"
L.OPT_PACK_INSTALLED = "Installé"
L.OPT_DOWNLOAD = "Télécharger"
L.OPT_DOWNLOAD_TIP = "Affiche l'adresse à copier dans votre navigateur."
L.OPT_DOWNLOAD_ADDRESS = "Copiez cette adresse dans votre navigateur pour télécharger le pack de voix."

-- Reading history
L.OPT_SECTION_HISTORY = "Historique de lecture"
L.OPT_FORGET_PLACES = "Oublier les lieux lus"
L.OPT_FORGET_PLACES_TIP = "Efface la liste des lieux que ce personnage a entendus. Le récit de l'endroit où vous vous trouvez est lu de nouveau à votre prochaine connexion et, si Inclure les lieux déjà découverts est activé, chaque lieu redevient non entendu."
L.OPT_FORGET_PLACES_DONE = "La liste des lieux lus par ce personnage est effacée."

-- Fix a problem
L.OPT_TEST_LINE = "Lire une réplique de test"
L.OPT_TEST_LINE_TIP = "Lit un récit, comme un vrai, pour vérifier que vous l'entendez : celui de l'endroit où vous êtes, ou un autre de votre pack de voix."
L.OPT_DIAGNOSTICS = "Afficher le diagnostic"
L.OPT_DIAGNOSTICS_TIP = "Affiche dans la fenêtre de discussion vos packs de voix et les réglages de lecture, pour un rapport de bug."

-- Starting over
L.OPT_SECTION_START_OVER = "Réinitialisation"
L.OPT_RESET_PAGE = "Réinitialiser les paramètres du module Lieux"
L.OPT_RESET_PAGE_TIP = "Remet les paramètres de cette page à leur valeur par défaut. Désactive aussi /spz debug, réaffiche le bouton de la minicarte (si Spoken n'est pas installé) et arrête l'aperçu des traductions inachevées. La langue des récits, le pack de voix choisi dans « Lire avec » et la liste des lieux déjà lus sont conservés."
L.OPT_RESET_PAGE_CONFIRM = "Remettre chaque paramètre du module Lieux à sa valeur par défaut ?"
L.OPT_RESET = "Réinitialiser"
L.OPT_CANCEL = "Annuler"
L.OPT_RELOAD_NOW = "Recharger maintenant"
L.OPT_LATER = "Plus tard"

-- Lore of Azeroth and Zone Lore
L.OPT_SECTION_LORE = "Compendium d'Azeroth"
L.OPT_LORE_WINDOW_TIP = "Le récit de chaque zone et sous-zone, à parcourir et à écouter où que vous soyez. Les lieux que vous n'avez pas encore découverts sont grisés."
L.OPT_SHOW_UNDISCOVERED = "Ouvrir les non découverts"
L.OPT_SHOW_UNDISCOVERED_TIP = "Permet d'ouvrir toutes les zones et sous-zones, y compris celles que vous n'avez pas encore découvertes. Sinon, elles sont grisées."
L.OPEN_IN_LORE_TIP = "Le récit de ce lieu dans le Compendium d'Azeroth, avec ceux de toutes les autres zones et sous-zones."
L.LORE_WINDOW_TITLE = "Compendium d'Azeroth"
L.COMPENDIUM_PLACES = "Lieux"
L.LORE_PANEL_TITLE = "Récit du lieu"
L.MAP_PANEL_EXPAND = "Afficher le récit du lieu"
L.PANEL_SHOWN = "Récit à côté de la carte : activé"
L.PANEL_HIDDEN = "Récit à côté de la carte : désactivé"
L.MINIMAP_LEFT_CLICK = "|cff66bbffClic gauche|r : %1$s"
L.LORE_SEARCH = "Rechercher un lieu"
L.LORE_DISCOVERED_ONLY = "Lieux découverts seulement"
L.LORE_VOICED_ONLY = "Lieux avec voix seulement"
L.LORE_SEARCH_NONE = "Aucun lieu ne correspond."
L.LORE_PICK = "Le récit de chaque lieu"
L.SUBZONE_COUNT_ONE = "1 sous-zone"
L.ZONE_COUNT_FMT = "%1$d zones"
L.ZONE_COUNT_ONE = "1 zone"
L.CONTINENT_COUNT_FMT = "%1$d continents"
L.CONTINENT_COUNT_ONE = "1 continent"

L.OPEN_IN_COMPENDIUM = "Ouvrir dans le Compendium d'Azeroth"

SpokenZones:RegisterStrings("frFR", L)
